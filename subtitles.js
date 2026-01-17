/**
 * Live Subtitles Module using Whisper (Xenova/transformers.js)
 * 
 * Uses a Web Worker for non-blocking transcription and
 * optimized audio chunking for lower latency.
 */

// Subtitle state
const SubtitleState = {
  worker: null,
  isModelLoaded: false,
  isModelLoading: false,
  isListening: false,
  audioContext: null,
  mediaStream: null,
  workletNode: null,
  analyserNode: null,
  audioChunks: [],
  lastTranscription: '',
  displayTimeout: null,
  processingTimeout: null,
  enabled: false,
  currentWords: [],
  currentWordIndex: 0,
  wordHighlightInterval: null,
  isProcessing: false,
  silenceStart: null,
  lastSpeechTime: 0
};

// Configuration - optimized for lower latency
const CONFIG = {
  sampleRate: 16000,
  chunkDuration: 2.0, // Process after 2 seconds of audio
  minChunkDuration: 0.3, // Minimum audio to process
  maxDisplayDuration: 4000,
  maxWordsPerLine: 10,
  wordHighlightSpeed: 120,
  // Voice Activity Detection settings
  vadThreshold: 0.005, // Lower threshold - more sensitive to speech
  silenceTimeout: 600, // ms of silence before processing
  minSpeechDuration: 100, // minimum ms of speech before considering valid
  // Use tiny model for faster processing (trade-off: slightly less accurate)
  modelName: 'Xenova/whisper-tiny.en',
  // Debug mode
  debug: true
};

/**
 * Initialize the Web Worker
 */
function initWorker() {
  if (SubtitleState.worker) return;

  try {
    SubtitleState.worker = new Worker('./subtitles-worker.js', { type: 'module' });
    
    SubtitleState.worker.onmessage = (event) => {
      const { type, text, status, message, processingTime, error } = event.data;
      
      switch (type) {
        case 'status':
          updateStatus(status, message);
          break;
        case 'model-loaded':
          SubtitleState.isModelLoaded = true;
          SubtitleState.isModelLoading = false;
          console.log('Whisper model loaded in worker');
          break;
        case 'transcription':
          handleTranscription(text, processingTime);
          break;
        case 'transcription-empty':
          // Reset processing state when no speech detected
          SubtitleState.isProcessing = false;
          updateStatus('active', 'Listening...');
          if (CONFIG.debug) console.log('[Subtitles] Empty transcription result');
          break;
        case 'error':
          console.error('Worker error:', error);
          SubtitleState.isProcessing = false;
          updateStatus('error', 'Error: ' + error);
          break;
      }
    };

    SubtitleState.worker.onerror = (error) => {
      console.error('Worker error:', error);
      updateStatus('error', 'Worker failed');
    };

    console.log('Subtitle worker initialized');
  } catch (error) {
    console.error('Failed to create worker:', error);
    // Fallback: will need to run on main thread
  }
}

/**
 * Initialize the Whisper model via worker
 */
async function initializeModel() {
  if (SubtitleState.isModelLoaded || SubtitleState.isModelLoading) {
    return SubtitleState.isModelLoaded;
  }

  initWorker();
  
  if (!SubtitleState.worker) {
    updateStatus('error', 'Worker unavailable');
    return false;
  }

  SubtitleState.isModelLoading = true;
  updateStatus('loading', 'Loading AI model...');

  return new Promise((resolve) => {
    const checkLoaded = () => {
      if (SubtitleState.isModelLoaded) {
        resolve(true);
      } else if (!SubtitleState.isModelLoading) {
        resolve(false);
      } else {
        setTimeout(checkLoaded, 100);
      }
    };

    SubtitleState.worker.postMessage({
      type: 'init',
      data: { modelName: CONFIG.modelName }
    });

    checkLoaded();
  });
}

/**
 * Handle transcription result from worker
 */
function handleTranscription(text, processingTime) {
  SubtitleState.isProcessing = false;
  
  if (!text || text === SubtitleState.lastTranscription) {
    return;
  }

  // Clean and validate text
  const cleanText = cleanTranscription(text);
  if (!cleanText || cleanText.length < 2) {
    return;
  }

  console.log(`Transcription (${Math.round(processingTime)}ms): "${cleanText}"`);
  
  SubtitleState.lastTranscription = text;
  displaySubtitle(cleanText);
  
  // Update status to show we're actively listening
  updateStatus('active', 'Listening...');
}

/**
 * Start capturing microphone audio with Voice Activity Detection
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

    // Create audio context at target sample rate
    SubtitleState.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: CONFIG.sampleRate
    });

    const source = SubtitleState.audioContext.createMediaStreamSource(SubtitleState.mediaStream);

    // Create analyser for VAD - use time domain for simpler level detection
    SubtitleState.analyserNode = SubtitleState.audioContext.createAnalyser();
    SubtitleState.analyserNode.fftSize = 2048;
    SubtitleState.analyserNode.smoothingTimeConstant = 0.5;

    // Create script processor for audio capture
    const bufferSize = 4096;
    const processor = SubtitleState.audioContext.createScriptProcessor(bufferSize, 1, 1);
    
    let frameCount = 0;
    let lastLogTime = 0;

    processor.onaudioprocess = (event) => {
      if (!SubtitleState.isListening) return;

      const inputData = event.inputBuffer.getChannelData(0);
      const now = Date.now();
      
      // Calculate RMS audio level directly from input
      const audioLevel = calculateRMS(inputData);
      const isSpeech = audioLevel > CONFIG.vadThreshold;

      // Debug logging (every 2 seconds)
      frameCount++;
      if (CONFIG.debug && now - lastLogTime > 2000) {
        console.log(`[Subtitles] Audio level: ${audioLevel.toFixed(4)}, Speech: ${isSpeech}, Buffer: ${getBufferDuration().toFixed(2)}s, Chunks: ${SubtitleState.audioChunks.length}`);
        lastLogTime = now;
      }

      // Always capture audio (simpler approach)
      SubtitleState.audioChunks.push(new Float32Array(inputData));

      if (isSpeech) {
        // Speech detected
        SubtitleState.lastSpeechTime = now;
        SubtitleState.silenceStart = null;
      } else {
        // Silence detected
        if (SubtitleState.silenceStart === null && SubtitleState.lastSpeechTime > 0) {
          SubtitleState.silenceStart = now;
        }

        // Check if we should process after silence
        if (SubtitleState.silenceStart && SubtitleState.lastSpeechTime > 0) {
          const silenceDuration = now - SubtitleState.silenceStart;
          const bufferDuration = getBufferDuration();

          // Process if we have enough silence after speech and enough audio
          if (silenceDuration >= CONFIG.silenceTimeout && bufferDuration >= CONFIG.minChunkDuration) {
            if (CONFIG.debug) console.log(`[Subtitles] Processing after ${silenceDuration}ms silence, ${bufferDuration.toFixed(2)}s audio`);
            processAudioBuffer();
          }
        }
      }

      // Also process if buffer gets too long
      const bufferDuration = getBufferDuration();
      if (bufferDuration >= CONFIG.chunkDuration && !SubtitleState.isProcessing) {
        if (CONFIG.debug) console.log(`[Subtitles] Processing due to buffer length: ${bufferDuration.toFixed(2)}s`);
        processAudioBuffer();
      }
      
      // Prevent memory buildup - trim old audio if not processing
      if (bufferDuration > CONFIG.chunkDuration * 2) {
        const samplesToKeep = Math.floor(CONFIG.chunkDuration * CONFIG.sampleRate);
        trimAudioBuffer(samplesToKeep);
      }
    };

    // Connect nodes
    source.connect(SubtitleState.analyserNode);
    source.connect(processor);
    processor.connect(SubtitleState.audioContext.destination);

    SubtitleState.processor = processor;
    SubtitleState.isListening = true;
    SubtitleState.audioChunks = [];
    SubtitleState.silenceStart = null;
    SubtitleState.lastSpeechTime = 0;

    updateStatus('active', 'Listening...');
    console.log('Microphone capture started with VAD');
  } catch (error) {
    console.error('Failed to access microphone:', error);
    updateStatus('error', 'Mic access denied');
    throw error;
  }
}

/**
 * Calculate RMS (Root Mean Square) audio level
 */
function calculateRMS(audioData) {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  return Math.sqrt(sum / audioData.length);
}

/**
 * Trim audio buffer to keep only recent samples
 */
function trimAudioBuffer(samplesToKeep) {
  const totalSamples = SubtitleState.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  if (totalSamples <= samplesToKeep) return;
  
  let samplesToRemove = totalSamples - samplesToKeep;
  while (samplesToRemove > 0 && SubtitleState.audioChunks.length > 0) {
    const chunk = SubtitleState.audioChunks[0];
    if (chunk.length <= samplesToRemove) {
      SubtitleState.audioChunks.shift();
      samplesToRemove -= chunk.length;
    } else {
      SubtitleState.audioChunks[0] = chunk.slice(samplesToRemove);
      break;
    }
  }
}

/**
 * Get current buffer duration in seconds
 */
function getBufferDuration() {
  const totalSamples = SubtitleState.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  return totalSamples / CONFIG.sampleRate;
}

/**
 * Process the accumulated audio buffer
 */
function processAudioBuffer() {
  if (SubtitleState.isProcessing || SubtitleState.audioChunks.length === 0) {
    return;
  }

  const bufferDuration = getBufferDuration();
  if (bufferDuration < CONFIG.minChunkDuration) {
    if (CONFIG.debug) console.log(`[Subtitles] Buffer too short (${bufferDuration.toFixed(2)}s), skipping`);
    SubtitleState.audioChunks = [];
    SubtitleState.lastSpeechTime = 0;
    return;
  }

  SubtitleState.isProcessing = true;
  updateStatus('active', 'Processing...');

  // Concatenate all audio chunks
  const totalLength = SubtitleState.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const audioData = new Float32Array(totalLength);
  
  let offset = 0;
  for (const chunk of SubtitleState.audioChunks) {
    audioData.set(chunk, offset);
    offset += chunk.length;
  }

  // Clear buffer and reset state
  SubtitleState.audioChunks = [];
  SubtitleState.silenceStart = null;
  SubtitleState.lastSpeechTime = 0;

  if (CONFIG.debug) console.log(`[Subtitles] Sending ${(totalLength / CONFIG.sampleRate).toFixed(2)}s audio to worker`);

  // Send to worker for transcription
  if (SubtitleState.worker && SubtitleState.isModelLoaded) {
    try {
      SubtitleState.worker.postMessage({
        type: 'transcribe',
        data: { 
          audio: audioData.buffer,
          sampleRate: CONFIG.sampleRate
        }
      }, [audioData.buffer]); // Transfer buffer for efficiency
    } catch (error) {
      console.error('[Subtitles] Failed to send to worker:', error);
      SubtitleState.isProcessing = false;
      updateStatus('active', 'Listening...');
    }
  } else {
    if (CONFIG.debug) console.log('[Subtitles] Worker not ready, skipping');
    SubtitleState.isProcessing = false;
    updateStatus('active', 'Listening...');
  }
}

/**
 * Stop capturing microphone audio
 */
function stopListening() {
  if (!SubtitleState.isListening) return;

  SubtitleState.isListening = false;

  // Disconnect audio processing
  if (SubtitleState.processor) {
    SubtitleState.processor.disconnect();
    SubtitleState.processor = null;
  }

  if (SubtitleState.analyserNode) {
    SubtitleState.analyserNode.disconnect();
    SubtitleState.analyserNode = null;
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
  SubtitleState.audioChunks = [];
  SubtitleState.isProcessing = false;

  // Stop word highlighting
  stopWordHighlight();

  updateStatus('', '');
  console.log('Microphone capture stopped');
}

/**
 * Clean up transcription text
 */
function cleanTranscription(text) {
  let clean = text
    .replace(/\[.*?\]/g, '') // Remove bracketed content
    .replace(/\(.*?\)/g, '') // Remove parenthetical content
    .replace(/<\|.*?\|>/g, '') // Remove Whisper tokens
    .replace(/♪/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Remove common Whisper hallucinations
  const hallucinations = [
    'thank you', 'thanks for watching', 'subscribe', 'like and subscribe',
    'see you next time', 'bye', 'goodbye', 'you'
  ];
  
  const lowerClean = clean.toLowerCase();
  for (const h of hallucinations) {
    if (lowerClean === h) {
      return '';
    }
  }
  
  // Capitalize first letter
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

  // Calculate if text needs to wrap based on screen width
  const words = text.split(' ').filter(w => w.length > 0);
  const wrappedWords = wrapTextToFitScreen(words);

  // Create word spans with animation classes
  const wordSpans = wrappedWords.map((word, index) => {
    const className = index === 0 ? 'word current' : 'word upcoming';
    return `<span class="${className}" data-index="${index}">${escapeHtml(word)}</span>`;
  }).join(' ');

  container.innerHTML = wordSpans;
  container.classList.add('new-text', 'has-highlight');
  
  // Show the overlay
  overlay.style.display = 'flex';

  // Start word highlighting animation
  SubtitleState.currentWords = wrappedWords;
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
    wrappedWords.length * CONFIG.wordHighlightSpeed + 1000
  );
  
  SubtitleState.displayTimeout = setTimeout(() => {
    hideSubtitle();
  }, displayDuration);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Wrap text to fit screen width
 */
function wrapTextToFitScreen(words) {
  const screenWidth = window.innerWidth;
  const maxCharsPerLine = Math.floor(screenWidth / 25);
  
  const result = [];
  let currentLength = 0;
  
  for (const word of words) {
    if (result.length >= CONFIG.maxWordsPerLine * 2) break;
    
    if (currentLength + word.length > maxCharsPerLine && result.length > 0) {
      // Start new conceptual line but keep in same array
      currentLength = word.length;
    } else {
      currentLength += word.length + 1;
    }
    result.push(word);
  }
  
  return result;
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
  
  // Expose functions globally for app.js to call
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
  
  console.log('Subtitle system initialized (Web Worker mode)');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubtitles);
} else {
  initSubtitles();
}

export { initSubtitles, toggleSubtitles, SubtitleState };
