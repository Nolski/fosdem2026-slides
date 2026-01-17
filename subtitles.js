/**
 * Live Subtitles Module using Whisper (Xenova/transformers.js)
 * 
 * Captures microphone audio and transcribes it in real-time
 * with modern social media-style subtitle display.
 */

// Import from local transformers.js file
import { pipeline, env } from './lib/transformers/transformers.min.js';

// Configure transformers.js to use local WASM files
env.backends.onnx.wasm.wasmPaths = './lib/transformers/';
// Allow loading from local files
env.allowLocalModels = false; // Models will still be fetched from HuggingFace and cached

// Subtitle state
const SubtitleState = {
  transcriber: null,
  isModelLoaded: false,
  isModelLoading: false,
  isListening: false,
  audioContext: null,
  mediaStream: null,
  processor: null,
  audioBuffer: [],
  lastTranscription: '',
  transcriptionHistory: [],
  displayTimeout: null,
  processingInterval: null,
  enabled: false,
  currentWords: [],
  currentWordIndex: 0,
  wordHighlightInterval: null
};

// Configuration
const CONFIG = {
  sampleRate: 16000,
  chunkDuration: 3, // seconds of audio to process at once
  overlapDuration: 0.5, // overlap between chunks
  maxDisplayDuration: 5000, // ms to keep subtitle on screen
  maxWordsPerLine: 12, // max words before wrapping
  wordHighlightSpeed: 150, // ms between word highlights
  minAudioLevel: 0.01, // minimum audio level to process
  modelName: 'Xenova/whisper-base.en'
};

/**
 * Initialize the Whisper transcription model
 */
async function initializeModel() {
  if (SubtitleState.isModelLoaded || SubtitleState.isModelLoading) {
    return SubtitleState.isModelLoaded;
  }

  SubtitleState.isModelLoading = true;
  updateStatus('loading', 'Loading AI model...');

  try {
    console.log('Loading Whisper model...');
    
    // Create the automatic speech recognition pipeline
    SubtitleState.transcriber = await pipeline(
      'automatic-speech-recognition',
      CONFIG.modelName,
      {
        quantized: true,
        progress_callback: (progress) => {
          if (progress.status === 'downloading') {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            updateStatus('loading', `Downloading model: ${percent}%`);
          } else if (progress.status === 'loading') {
            updateStatus('loading', 'Loading model...');
          }
        }
      }
    );

    SubtitleState.isModelLoaded = true;
    SubtitleState.isModelLoading = false;
    console.log('Whisper model loaded successfully');
    updateStatus('', '');
    return true;
  } catch (error) {
    console.error('Failed to load Whisper model:', error);
    SubtitleState.isModelLoading = false;
    updateStatus('error', 'Failed to load model');
    throw error;
  }
}

/**
 * Start capturing microphone audio
 */
async function startListening() {
  if (SubtitleState.isListening) return;

  try {
    // Request microphone access
    SubtitleState.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: CONFIG.sampleRate,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Create audio context
    SubtitleState.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: CONFIG.sampleRate
    });

    // Create source from microphone
    const source = SubtitleState.audioContext.createMediaStreamSource(SubtitleState.mediaStream);

    // Create script processor for audio processing
    const bufferSize = 4096;
    SubtitleState.processor = SubtitleState.audioContext.createScriptProcessor(bufferSize, 1, 1);

    SubtitleState.processor.onaudioprocess = (event) => {
      if (!SubtitleState.isListening) return;

      const inputData = event.inputBuffer.getChannelData(0);
      // Store audio data for processing
      SubtitleState.audioBuffer.push(new Float32Array(inputData));
    };

    // Connect nodes
    source.connect(SubtitleState.processor);
    SubtitleState.processor.connect(SubtitleState.audioContext.destination);

    SubtitleState.isListening = true;
    SubtitleState.audioBuffer = [];

    // Start processing interval
    startProcessingLoop();

    updateStatus('active', 'Listening...');
    console.log('Microphone capture started');
  } catch (error) {
    console.error('Failed to access microphone:', error);
    updateStatus('error', 'Mic access denied');
    throw error;
  }
}

/**
 * Stop capturing microphone audio
 */
function stopListening() {
  if (!SubtitleState.isListening) return;

  SubtitleState.isListening = false;

  // Stop processing loop
  if (SubtitleState.processingInterval) {
    clearInterval(SubtitleState.processingInterval);
    SubtitleState.processingInterval = null;
  }

  // Disconnect audio processing
  if (SubtitleState.processor) {
    SubtitleState.processor.disconnect();
    SubtitleState.processor = null;
  }

  // Close audio context
  if (SubtitleState.audioContext) {
    SubtitleState.audioContext.close();
    SubtitleState.audioContext = null;
  }

  // Stop media stream
  if (SubtitleState.mediaStream) {
    SubtitleState.mediaStream.getTracks().forEach(track => track.stop());
    SubtitleState.mediaStream = null;
  }

  // Clear buffers
  SubtitleState.audioBuffer = [];

  // Stop word highlighting
  stopWordHighlight();

  updateStatus('', '');
  console.log('Microphone capture stopped');
}

/**
 * Start the audio processing loop
 */
function startProcessingLoop() {
  const processInterval = CONFIG.chunkDuration * 1000;
  
  SubtitleState.processingInterval = setInterval(async () => {
    if (!SubtitleState.isListening || SubtitleState.audioBuffer.length === 0) {
      return;
    }

    try {
      await processAudioBuffer();
    } catch (error) {
      console.error('Error processing audio:', error);
    }
  }, processInterval);
}

/**
 * Process accumulated audio buffer
 */
async function processAudioBuffer() {
  if (!SubtitleState.transcriber || SubtitleState.audioBuffer.length === 0) {
    return;
  }

  // Concatenate all audio chunks
  const totalLength = SubtitleState.audioBuffer.reduce((acc, chunk) => acc + chunk.length, 0);
  const audioData = new Float32Array(totalLength);
  
  let offset = 0;
  for (const chunk of SubtitleState.audioBuffer) {
    audioData.set(chunk, offset);
    offset += chunk.length;
  }

  // Keep some overlap for the next chunk
  const overlapSamples = Math.floor(CONFIG.overlapDuration * CONFIG.sampleRate);
  if (totalLength > overlapSamples) {
    SubtitleState.audioBuffer = [audioData.slice(-overlapSamples)];
  } else {
    SubtitleState.audioBuffer = [];
  }

  // Check if audio has sufficient level
  const audioLevel = calculateAudioLevel(audioData);
  if (audioLevel < CONFIG.minAudioLevel) {
    return;
  }

  // Transcribe the audio
  try {
    const result = await SubtitleState.transcriber(audioData, {
      chunk_length_s: CONFIG.chunkDuration,
      stride_length_s: CONFIG.overlapDuration,
      return_timestamps: false
    });

    if (result && result.text) {
      const text = result.text.trim();
      
      // Skip if same as last transcription or empty
      if (text && text !== SubtitleState.lastTranscription && text.length > 1) {
        SubtitleState.lastTranscription = text;
        displaySubtitle(text);
      }
    }
  } catch (error) {
    console.error('Transcription error:', error);
  }
}

/**
 * Calculate the RMS audio level
 */
function calculateAudioLevel(audioData) {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  return Math.sqrt(sum / audioData.length);
}

/**
 * Display subtitle with word-by-word highlighting
 */
function displaySubtitle(text) {
  const overlay = document.getElementById('subtitle-overlay');
  const container = document.getElementById('subtitle-text');
  
  if (!overlay || !container) return;

  // Clean up the text
  const cleanText = cleanTranscription(text);
  if (!cleanText) return;

  // Calculate if text needs to wrap based on screen width
  const words = cleanText.split(' ').filter(w => w.length > 0);
  const wrappedText = wrapTextToFitScreen(words);

  // Create word spans with animation classes
  const wordSpans = wrappedText.map((word, index) => {
    const className = index === 0 ? 'word current' : 'word upcoming';
    return `<span class="${className}" data-index="${index}">${word}</span>`;
  }).join(' ');

  container.innerHTML = wordSpans;
  container.classList.add('new-text', 'has-highlight');
  
  // Show the overlay
  overlay.style.display = 'flex';

  // Start word highlighting animation
  SubtitleState.currentWords = wrappedText;
  SubtitleState.currentWordIndex = 0;
  startWordHighlight();

  // Clear previous timeout
  if (SubtitleState.displayTimeout) {
    clearTimeout(SubtitleState.displayTimeout);
  }

  // Remove new-text class after animation
  setTimeout(() => {
    container.classList.remove('new-text');
  }, 300);

  // Set timeout to fade out subtitle
  const displayDuration = Math.max(
    CONFIG.maxDisplayDuration,
    wrappedText.length * CONFIG.wordHighlightSpeed + 1000
  );
  
  SubtitleState.displayTimeout = setTimeout(() => {
    hideSubtitle();
  }, displayDuration);
}

/**
 * Clean up transcription text
 */
function cleanTranscription(text) {
  // Remove common Whisper artifacts
  let clean = text
    .replace(/\[.*?\]/g, '') // Remove bracketed content like [MUSIC]
    .replace(/\(.*?\)/g, '') // Remove parenthetical content
    .replace(/♪/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Capitalize first letter
  if (clean.length > 0) {
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  
  return clean;
}

/**
 * Wrap text to fit screen width
 */
function wrapTextToFitScreen(words) {
  // Get available width
  const screenWidth = window.innerWidth;
  const maxCharsPerLine = Math.floor(screenWidth / 20); // Approximate chars that fit
  
  const result = [];
  let currentLine = [];
  let currentLength = 0;
  
  for (const word of words) {
    if (currentLength + word.length > maxCharsPerLine && currentLine.length > 0) {
      // Word would exceed line, but we keep single words
      if (result.length === 0 || currentLine.length <= CONFIG.maxWordsPerLine) {
        result.push(...currentLine);
      }
      currentLine = [word];
      currentLength = word.length;
    } else {
      currentLine.push(word);
      currentLength += word.length + 1;
    }
  }
  
  // Add remaining words
  if (currentLine.length > 0) {
    result.push(...currentLine);
  }
  
  // Limit total words
  return result.slice(0, CONFIG.maxWordsPerLine * 2);
}

/**
 * Start word-by-word highlight animation
 */
function startWordHighlight() {
  stopWordHighlight();
  
  SubtitleState.wordHighlightInterval = setInterval(() => {
    const container = document.getElementById('subtitle-text');
    if (!container) return;
    
    const words = container.querySelectorAll('.word');
    
    // Update word classes
    words.forEach((word, index) => {
      word.classList.remove('current', 'spoken', 'upcoming');
      
      if (index < SubtitleState.currentWordIndex) {
        word.classList.add('spoken');
      } else if (index === SubtitleState.currentWordIndex) {
        word.classList.add('current');
      } else {
        word.classList.add('upcoming');
      }
    });
    
    SubtitleState.currentWordIndex++;
    
    // Stop when all words are highlighted
    if (SubtitleState.currentWordIndex > SubtitleState.currentWords.length) {
      stopWordHighlight();
    }
  }, CONFIG.wordHighlightSpeed);
}

/**
 * Stop word highlight animation
 */
function stopWordHighlight() {
  if (SubtitleState.wordHighlightInterval) {
    clearInterval(SubtitleState.wordHighlightInterval);
    SubtitleState.wordHighlightInterval = null;
  }
}

/**
 * Hide the subtitle overlay
 */
function hideSubtitle() {
  const overlay = document.getElementById('subtitle-overlay');
  const container = document.getElementById('subtitle-text');
  
  if (overlay) {
    overlay.style.display = 'none';
  }
  
  if (container) {
    container.innerHTML = '';
    container.classList.remove('has-highlight');
  }
  
  stopWordHighlight();
}

/**
 * Update the status indicator
 */
function updateStatus(type, message) {
  const statusEl = document.getElementById('subtitle-status');
  if (!statusEl) return;
  
  statusEl.className = 'subtitle-status';
  if (type) {
    statusEl.classList.add(type);
  }
  statusEl.textContent = message;
}

/**
 * Toggle subtitles on/off
 */
async function toggleSubtitles(enabled) {
  SubtitleState.enabled = enabled;
  
  if (enabled) {
    try {
      // Initialize model if needed
      if (!SubtitleState.isModelLoaded) {
        await initializeModel();
      }
      
      // Start listening if presentation is active
      if (window.presentationStarted) {
        await startListening();
      }
    } catch (error) {
      console.error('Failed to enable subtitles:', error);
      // Uncheck the toggle on error
      const checkbox = document.getElementById('subtitlesEnabled');
      if (checkbox) checkbox.checked = false;
      SubtitleState.enabled = false;
    }
  } else {
    stopListening();
    hideSubtitle();
  }
}

/**
 * Initialize subtitle system
 */
function initSubtitles() {
  // Set up toggle listener
  const toggle = document.getElementById('subtitlesEnabled');
  if (toggle) {
    toggle.addEventListener('change', (e) => {
      toggleSubtitles(e.target.checked);
    });
  }
  
  // Listen for presentation state changes
  // We'll expose functions globally for app.js to call
  window.subtitleSystem = {
    onPresentationStart: async () => {
      if (SubtitleState.enabled) {
        try {
          if (!SubtitleState.isModelLoaded) {
            await initializeModel();
          }
          await startListening();
        } catch (error) {
          console.error('Failed to start subtitles:', error);
        }
      }
    },
    onPresentationEnd: () => {
      stopListening();
      hideSubtitle();
    },
    isEnabled: () => SubtitleState.enabled,
    toggle: toggleSubtitles
  };
  
  console.log('Subtitle system initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubtitles);
} else {
  initSubtitles();
}

// Export for potential external use
export { initSubtitles, toggleSubtitles, SubtitleState };
