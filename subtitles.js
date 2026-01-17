/**
 * Live Subtitles Module using Whisper
 * 
 * Simple, reliable approach: continuous audio capture with
 * time-based chunking. Whisper handles silence detection internally.
 */

import { pipeline, env } from './lib/transformers/transformers.min.js';

// Configure transformers.js
env.backends.onnx.wasm.wasmPaths = './lib/transformers/';
env.allowLocalModels = false;

// State
const SubtitleState = {
  transcriber: null,
  isModelLoaded: false,
  isModelLoading: false,
  isListening: false,
  enabled: false,
  audioContext: null,
  mediaStream: null,
  processor: null,
  audioBuffer: [],
  isTranscribing: false,
  lastTranscription: '',
  displayTimeout: null,
  processInterval: null,
  currentWords: [],
  currentWordIndex: 0,
  wordHighlightInterval: null
};

// Configuration
const CONFIG = {
  sampleRate: 16000,
  chunkSeconds: 2.5,        // Process every 2.5 seconds
  minAudioLevel: 0.01,      // Skip if audio is too quiet
  maxDisplayDuration: 4000,
  maxWordsPerLine: 10,
  wordHighlightSpeed: 120,
  modelName: 'Xenova/whisper-tiny.en',
  debug: true
};

/**
 * Initialize Whisper model
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
 * Start listening with simple audio capture
 */
async function startListening() {
  if (SubtitleState.isListening) return;

  try {
    updateStatus('loading', 'Starting mic...');
    
    // Get microphone
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

    const source = SubtitleState.audioContext.createMediaStreamSource(SubtitleState.mediaStream);
    
    // Use ScriptProcessor for simplicity (yes it's deprecated, but it works reliably)
    const bufferSize = 4096;
    SubtitleState.processor = SubtitleState.audioContext.createScriptProcessor(bufferSize, 1, 1);

    SubtitleState.processor.onaudioprocess = (event) => {
      if (!SubtitleState.isListening) return;
      const inputData = event.inputBuffer.getChannelData(0);
      SubtitleState.audioBuffer.push(new Float32Array(inputData));
    };

    source.connect(SubtitleState.processor);
    SubtitleState.processor.connect(SubtitleState.audioContext.destination);

    SubtitleState.isListening = true;
    SubtitleState.audioBuffer = [];

    // Process audio at regular intervals
    SubtitleState.processInterval = setInterval(() => {
      processAudioChunk();
    }, CONFIG.chunkSeconds * 1000);

    updateStatus('active', 'Listening...');
    console.log('[Subtitles] Microphone started');

  } catch (error) {
    console.error('[Subtitles] Failed to start:', error);
    updateStatus('error', 'Mic failed: ' + error.message);
    throw error;
  }
}

/**
 * Process accumulated audio
 */
async function processAudioChunk() {
  if (SubtitleState.isTranscribing || SubtitleState.audioBuffer.length === 0) {
    return;
  }

  // Concatenate audio chunks
  const totalLength = SubtitleState.audioBuffer.reduce((acc, chunk) => acc + chunk.length, 0);
  const audioData = new Float32Array(totalLength);
  
  let offset = 0;
  for (const chunk of SubtitleState.audioBuffer) {
    audioData.set(chunk, offset);
    offset += chunk.length;
  }

  // Clear buffer for next chunk
  SubtitleState.audioBuffer = [];

  // Check audio level - skip if too quiet
  const rms = calculateRMS(audioData);
  if (rms < CONFIG.minAudioLevel) {
    if (CONFIG.debug) console.log(`[Subtitles] Skipping quiet audio (RMS: ${rms.toFixed(4)})`);
    return;
  }

  // Transcribe
  SubtitleState.isTranscribing = true;
  updateStatus('active', 'Processing...');

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
        console.log(`[Subtitles] (${Math.round(processingTime)}ms) "${text}"`);
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
  }
}

/**
 * Calculate RMS audio level
 */
function calculateRMS(audioData) {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  return Math.sqrt(sum / audioData.length);
}

/**
 * Stop listening
 */
function stopListening() {
  if (!SubtitleState.isListening) return;

  SubtitleState.isListening = false;

  if (SubtitleState.processInterval) {
    clearInterval(SubtitleState.processInterval);
    SubtitleState.processInterval = null;
  }

  if (SubtitleState.processor) {
    SubtitleState.processor.disconnect();
    SubtitleState.processor = null;
  }

  if (SubtitleState.audioContext) {
    SubtitleState.audioContext.close();
    SubtitleState.audioContext = null;
  }

  if (SubtitleState.mediaStream) {
    SubtitleState.mediaStream.getTracks().forEach(track => track.stop());
    SubtitleState.mediaStream = null;
  }

  SubtitleState.audioBuffer = [];
  stopWordHighlight();
  hideSubtitle();
  
  updateStatus('', '');
  console.log('[Subtitles] Stopped');
}

/**
 * Clean transcription text
 */
function cleanTranscription(text) {
  let clean = text
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/<\|.*?\|>/g, '')
    .replace(/♪/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Filter Whisper hallucinations
  const hallucinations = [
    'thank you', 'thanks for watching', 'subscribe', 'like and subscribe',
    'see you', 'bye', 'goodbye', 'you', 'the end', 'thanks', 'thank you for watching',
    'please subscribe', 'don\'t forget to subscribe', ''
  ];
  
  if (hallucinations.includes(clean.toLowerCase())) {
    return '';
  }
  
  // Capitalize
  if (clean.length > 0) {
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  
  return clean;
}

/**
 * Display subtitle
 */
function displaySubtitle(text) {
  const overlay = document.getElementById('subtitle-overlay');
  const container = document.getElementById('subtitle-text');
  
  if (!overlay || !container) return;

  const words = text.split(' ').filter(w => w.length > 0);
  const wrappedWords = wrapTextToFitScreen(words);

  const wordSpans = wrappedWords.map((word, index) => {
    const className = index === 0 ? 'word current' : 'word upcoming';
    return `<span class="${className}">${escapeHtml(word)}</span>`;
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

  setTimeout(() => container.classList.remove('new-text'), 300);

  const displayDuration = Math.max(
    CONFIG.maxDisplayDuration,
    wrappedWords.length * CONFIG.wordHighlightSpeed + 1000
  );
  
  SubtitleState.displayTimeout = setTimeout(hideSubtitle, displayDuration);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function wrapTextToFitScreen(words) {
  const maxChars = Math.floor(window.innerWidth / 25);
  const result = [];
  let len = 0;
  
  for (const word of words) {
    if (result.length >= CONFIG.maxWordsPerLine * 2) break;
    if (len + word.length > maxChars && result.length > 0) {
      len = word.length;
    } else {
      len += word.length + 1;
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
  
  if (overlay) overlay.style.display = 'none';
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
  if (type) statusEl.classList.add(type);
  statusEl.textContent = message;
}

/**
 * Toggle subtitles
 */
async function toggleSubtitles(enabled) {
  SubtitleState.enabled = enabled;
  
  if (enabled) {
    try {
      if (!SubtitleState.isModelLoaded) {
        await initializeWhisper();
      }
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
  }
}

/**
 * Initialize
 */
function initSubtitles() {
  const toggle = document.getElementById('subtitlesEnabled');
  if (toggle) {
    toggle.addEventListener('change', (e) => toggleSubtitles(e.target.checked));
  }
  
  window.subtitleSystem = {
    onPresentationStart: async () => {
      if (SubtitleState.enabled) {
        if (!SubtitleState.isModelLoaded) await initializeWhisper();
        await startListening();
      }
    },
    onPresentationEnd: () => stopListening(),
    isEnabled: () => SubtitleState.enabled,
    toggle: toggleSubtitles
  };
  
  console.log('[Subtitles] Initialized (simple mode)');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubtitles);
} else {
  initSubtitles();
}

export { initSubtitles, toggleSubtitles };
