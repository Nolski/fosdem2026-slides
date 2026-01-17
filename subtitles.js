/**
 * Live Subtitles Module using Silero VAD + Whisper
 * 
 * Uses Silero VAD (neural network) for accurate real-time voice detection
 * and Whisper for transcription.
 */

// Import from local transformers.js file
import { pipeline, env } from './lib/transformers/transformers.min.js';

// Configure transformers.js
env.backends.onnx.wasm.wasmPaths = './lib/transformers/';
env.allowLocalModels = false;

// Subtitle state
const SubtitleState = {
  vadInstance: null,
  transcriber: null,
  isModelLoaded: false,
  isModelLoading: false,
  isListening: false,
  enabled: false,
  lastTranscription: '',
  displayTimeout: null,
  currentWords: [],
  currentWordIndex: 0,
  wordHighlightInterval: null,
  pendingAudio: null,
  isTranscribing: false
};

// Configuration
const CONFIG = {
  maxDisplayDuration: 4000,
  maxWordsPerLine: 10,
  wordHighlightSpeed: 120,
  modelName: 'Xenova/whisper-tiny.en',
  debug: true
};

/**
 * Initialize the Whisper transcription model
 */
async function initializeWhisper() {
  if (SubtitleState.isModelLoaded || SubtitleState.isModelLoading) {
    return SubtitleState.isModelLoaded;
  }

  SubtitleState.isModelLoading = true;
  updateStatus('loading', 'Loading Whisper...');

  try {
    console.log('[Subtitles] Loading Whisper model...');
    
    SubtitleState.transcriber = await pipeline(
      'automatic-speech-recognition',
      CONFIG.modelName,
      {
        quantized: true,
        progress_callback: (progress) => {
          if (progress.status === 'downloading') {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            updateStatus('loading', `Downloading: ${percent}%`);
          } else if (progress.status === 'loading') {
            updateStatus('loading', 'Initializing...');
          }
        }
      }
    );

    SubtitleState.isModelLoaded = true;
    SubtitleState.isModelLoading = false;
    console.log('[Subtitles] Whisper model loaded');
    updateStatus('', '');
    return true;
  } catch (error) {
    console.error('[Subtitles] Failed to load Whisper:', error);
    SubtitleState.isModelLoading = false;
    updateStatus('error', 'Model load failed');
    throw error;
  }
}

/**
 * Transcribe audio using Whisper
 */
async function transcribeAudio(audioData) {
  if (!SubtitleState.transcriber || SubtitleState.isTranscribing) {
    // Queue the audio if we're busy
    SubtitleState.pendingAudio = audioData;
    return;
  }

  SubtitleState.isTranscribing = true;
  updateStatus('active', 'Transcribing...');

  try {
    const startTime = performance.now();
    
    const result = await SubtitleState.transcriber(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      language: 'english',
      task: 'transcribe'
    });

    const processingTime = performance.now() - startTime;

    if (result && result.text) {
      const text = cleanTranscription(result.text);
      if (CONFIG.debug) {
        console.log(`[Subtitles] Transcription (${Math.round(processingTime)}ms): "${text}"`);
      }
      
      if (text && text.length > 1 && text !== SubtitleState.lastTranscription) {
        SubtitleState.lastTranscription = text;
        displaySubtitle(text);
      }
    }
  } catch (error) {
    console.error('[Subtitles] Transcription error:', error);
  } finally {
    SubtitleState.isTranscribing = false;
    updateStatus('active', 'Listening...');
    
    // Process pending audio if any
    if (SubtitleState.pendingAudio) {
      const pending = SubtitleState.pendingAudio;
      SubtitleState.pendingAudio = null;
      transcribeAudio(pending);
    }
  }
}

/**
 * Initialize VAD and start listening
 */
async function startListening() {
  if (SubtitleState.isListening) return;

  try {
    updateStatus('loading', 'Starting VAD...');
    
    // Check if vad is available (loaded from vad.bundle.min.js)
    if (typeof vad === 'undefined') {
      throw new Error('VAD library not loaded');
    }

    console.log('[Subtitles] Initializing Silero VAD...');

    // Create VAD instance with callbacks
    SubtitleState.vadInstance = await vad.MicVAD.new({
      // Use local model files
      modelURL: './lib/vad/silero_vad_legacy.onnx',
      workletURL: './lib/vad/vad.worklet.bundle.min.js',
      
      // VAD parameters for responsiveness
      positiveSpeechThreshold: 0.5,  // Lower = more sensitive
      negativeSpeechThreshold: 0.35,
      redemptionFrames: 8,           // Frames to wait before ending speech
      minSpeechFrames: 3,            // Minimum frames to consider as speech
      preSpeechPadFrames: 10,        // Frames to include before speech start
      
      // Callbacks
      onSpeechStart: () => {
        if (CONFIG.debug) console.log('[VAD] Speech started');
        updateStatus('active', 'Speaking...');
      },
      
      onSpeechEnd: (audio) => {
        // audio is Float32Array at 16kHz - perfect for Whisper!
        if (CONFIG.debug) console.log(`[VAD] Speech ended, ${(audio.length / 16000).toFixed(2)}s audio`);
        
        // Send to Whisper for transcription
        if (SubtitleState.isModelLoaded && audio.length > 1600) { // Min 0.1s
          transcribeAudio(audio);
        }
      },
      
      onVADMisfire: () => {
        if (CONFIG.debug) console.log('[VAD] Misfire (too short)');
      }
    });

    // Start the VAD
    SubtitleState.vadInstance.start();
    SubtitleState.isListening = true;
    
    updateStatus('active', 'Listening...');
    console.log('[Subtitles] VAD started - listening for speech');
    
  } catch (error) {
    console.error('[Subtitles] Failed to start VAD:', error);
    updateStatus('error', 'VAD failed: ' + error.message);
    throw error;
  }
}

/**
 * Stop listening
 */
function stopListening() {
  if (!SubtitleState.isListening) return;

  if (SubtitleState.vadInstance) {
    SubtitleState.vadInstance.pause();
    SubtitleState.vadInstance.destroy();
    SubtitleState.vadInstance = null;
  }

  SubtitleState.isListening = false;
  SubtitleState.pendingAudio = null;
  stopWordHighlight();
  
  updateStatus('', '');
  console.log('[Subtitles] Stopped listening');
}

/**
 * Clean up transcription text
 */
function cleanTranscription(text) {
  let clean = text
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/<\|.*?\|>/g, '')
    .replace(/♪/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Remove common Whisper hallucinations
  const hallucinations = [
    'thank you', 'thanks for watching', 'subscribe', 'like and subscribe',
    'see you next time', 'bye', 'goodbye', 'you', 'the end', 'thanks'
  ];
  
  const lowerClean = clean.toLowerCase();
  for (const h of hallucinations) {
    if (lowerClean === h) {
      return '';
    }
  }
  
  if (clean.length > 0) {
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  
  return clean;
}

/**
 * Display subtitle with word-by-word highlighting
 */
function displaySubtitle(text) {
  const overlay = document.getElementById('subtitle-overlay');
  const container = document.getElementById('subtitle-text');
  
  if (!overlay || !container) return;

  const words = text.split(' ').filter(w => w.length > 0);
  const wrappedWords = wrapTextToFitScreen(words);

  const wordSpans = wrappedWords.map((word, index) => {
    const className = index === 0 ? 'word current' : 'word upcoming';
    return `<span class="${className}" data-index="${index}">${escapeHtml(word)}</span>`;
  }).join(' ');

  container.innerHTML = wordSpans;
  container.classList.add('new-text', 'has-highlight');
  
  overlay.style.display = 'flex';

  SubtitleState.currentWords = wrappedWords;
  SubtitleState.currentWordIndex = 0;
  startWordHighlight();

  if (SubtitleState.displayTimeout) {
    clearTimeout(SubtitleState.displayTimeout);
  }

  setTimeout(() => {
    container.classList.remove('new-text');
  }, 300);

  const displayDuration = Math.max(
    CONFIG.maxDisplayDuration,
    wrappedWords.length * CONFIG.wordHighlightSpeed + 1000
  );
  
  SubtitleState.displayTimeout = setTimeout(() => {
    hideSubtitle();
  }, displayDuration);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function wrapTextToFitScreen(words) {
  const screenWidth = window.innerWidth;
  const maxCharsPerLine = Math.floor(screenWidth / 25);
  
  const result = [];
  let currentLength = 0;
  
  for (const word of words) {
    if (result.length >= CONFIG.maxWordsPerLine * 2) break;
    
    if (currentLength + word.length > maxCharsPerLine && result.length > 0) {
      currentLength = word.length;
    } else {
      currentLength += word.length + 1;
    }
    result.push(word);
  }
  
  return result;
}

function startWordHighlight() {
  stopWordHighlight();
  
  SubtitleState.wordHighlightInterval = setInterval(() => {
    const container = document.getElementById('subtitle-text');
    if (!container) return;
    
    const words = container.querySelectorAll('.word');
    
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
    
    if (SubtitleState.currentWordIndex > SubtitleState.currentWords.length) {
      stopWordHighlight();
    }
  }, CONFIG.wordHighlightSpeed);
}

function stopWordHighlight() {
  if (SubtitleState.wordHighlightInterval) {
    clearInterval(SubtitleState.wordHighlightInterval);
    SubtitleState.wordHighlightInterval = null;
  }
}

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
      // Initialize Whisper model if needed
      if (!SubtitleState.isModelLoaded) {
        await initializeWhisper();
      }
      
      // Start VAD listening if presentation is active
      if (window.presentationStarted) {
        await startListening();
      }
    } catch (error) {
      console.error('[Subtitles] Failed to enable:', error);
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
  const toggle = document.getElementById('subtitlesEnabled');
  if (toggle) {
    toggle.addEventListener('change', (e) => {
      toggleSubtitles(e.target.checked);
    });
  }
  
  // Expose functions globally for app.js
  window.subtitleSystem = {
    onPresentationStart: async () => {
      if (SubtitleState.enabled) {
        try {
          if (!SubtitleState.isModelLoaded) {
            await initializeWhisper();
          }
          await startListening();
        } catch (error) {
          console.error('[Subtitles] Failed to start:', error);
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
  
  console.log('[Subtitles] System initialized (Silero VAD + Whisper)');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubtitles);
} else {
  initSubtitles();
}

export { initSubtitles, toggleSubtitles, SubtitleState };
