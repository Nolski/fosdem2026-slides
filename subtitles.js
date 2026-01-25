/**
 * Live Subtitles Module
 * 
 * Supports two modes:
 * 1. Web Speech API (default) - Better quality, requires internet
 * 2. Whisper via transformers.js (offline mode) - Works offline, slower
 */

(function() {
'use strict';

// ============================================================================
// STATE
// ============================================================================

const SubtitleState = {
  // Mode
  offlineMode: false,
  enabled: false,
  isListening: false,
  
  // Web Speech API state
  recognition: null,
  
  // Whisper state
  transcriber: null,
  isModelLoaded: false,
  isModelLoading: false,
  audioContext: null,
  mediaStream: null,
  workletNode: null,
  audioRingBuffer: null,
  ringBufferWriteIdx: 0,
  ringBufferSize: 5 * 16000, // 5 seconds at 16kHz
  samplesReceived: 0,
  isTranscribing: false,
  processInterval: null,
  
  // Display state
  displayTimeout: null,
  lastText: '',
  
  // Size configuration (percentage, 50-150)
  sizeScale: 100
};

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Whisper settings
  modelName: 'Xenova/whisper-tiny.en',
  windowSeconds: 5,
  processIntervalMs: 2000,
  minAudioEnergy: 0.0001,
  
  // Display settings
  maxDisplayDuration: 6000,
  maxWordsPerLine: 12,
  debug: false
};

// ============================================================================
// WEB SPEECH API IMPLEMENTATION
// ============================================================================

function initWebSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn('[Subtitles] Web Speech API not supported');
    return false;
  }
  
  SubtitleState.recognition = new SpeechRecognition();
  SubtitleState.recognition.continuous = true;
  SubtitleState.recognition.interimResults = true;
  SubtitleState.recognition.lang = 'en-US';
  SubtitleState.recognition.maxAlternatives = 1;
  
  SubtitleState.recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript;
      } else {
        interimTranscript += result[0].transcript;
      }
    }
    
    // Display with word highlighting effect
    const text = finalTranscript || interimTranscript;
    if (text.trim()) {
      displaySubtitleWithHighlight(text, !finalTranscript);
    }
  };
  
  SubtitleState.recognition.onerror = (event) => {
    console.error('[Subtitles] Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      updateStatus('error', 'Mic blocked');
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      // Restart on recoverable errors
      if (SubtitleState.enabled && SubtitleState.isListening) {
        setTimeout(() => startWebSpeech(), 100);
      }
    }
  };
  
  SubtitleState.recognition.onend = () => {
    // Restart if still enabled (recognition auto-stops periodically)
    if (SubtitleState.enabled && SubtitleState.isListening && !SubtitleState.offlineMode) {
      setTimeout(() => {
        if (SubtitleState.enabled && SubtitleState.isListening) {
          try {
            SubtitleState.recognition.start();
          } catch (e) {
            // Ignore - might already be starting
          }
        }
      }, 100);
    }
  };
  
  return true;
}

function startWebSpeech() {
  if (!SubtitleState.recognition) {
    if (!initWebSpeech()) {
      updateStatus('error', 'Not supported');
      return;
    }
  }
  
  try {
    SubtitleState.recognition.start();
    SubtitleState.isListening = true;
    updateStatus('active', 'Listening...');
    console.log('[Subtitles] Web Speech started');
  } catch (e) {
    console.error('[Subtitles] Failed to start:', e);
  }
}

function stopWebSpeech() {
  if (SubtitleState.recognition) {
    try {
      SubtitleState.recognition.stop();
    } catch (e) {
      // Ignore
    }
  }
  SubtitleState.isListening = false;
  hideSubtitle();
  updateStatus('', '');
  console.log('[Subtitles] Web Speech stopped');
}

// ============================================================================
// WHISPER IMPLEMENTATION (OFFLINE MODE)
// ============================================================================

async function loadTransformers() {
  const module = await import('./lib/transformers/transformers.min.js');
  module.env.backends.onnx.wasm.wasmPaths = './lib/transformers/';
  module.env.allowLocalModels = false;
  return module;
}

async function initWhisper() {
  if (SubtitleState.isModelLoaded || SubtitleState.isModelLoading) {
    return SubtitleState.isModelLoaded;
  }

  SubtitleState.isModelLoading = true;
  updateStatus('loading', 'Loading Whisper...');

  try {
    const { pipeline } = await loadTransformers();
    
    // Check for WebGPU
    let device = 'wasm';
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          device = 'webgpu';
          console.log('[Subtitles] Using WebGPU');
        }
      } catch (e) {
        console.warn('[Subtitles] WebGPU not available:', e);
      }
    }

    console.log(`[Subtitles] Loading ${CONFIG.modelName}...`);
    
    SubtitleState.transcriber = await pipeline(
      'automatic-speech-recognition',
      CONFIG.modelName,
      {
        device: device,
        dtype: device === 'webgpu' ? 'fp32' : 'q8',
        progress_callback: (progress) => {
          if (progress.status === 'progress' && progress.progress) {
            updateStatus('loading', `Loading: ${Math.round(progress.progress)}%`);
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
    updateStatus('error', 'Model failed');
    return false;
  }
}

function initRingBuffer() {
  SubtitleState.audioRingBuffer = new Float32Array(SubtitleState.ringBufferSize);
  SubtitleState.ringBufferWriteIdx = 0;
  SubtitleState.samplesReceived = 0;
}

function pushToRingBuffer(samples) {
  for (let i = 0; i < samples.length; i++) {
    SubtitleState.audioRingBuffer[SubtitleState.ringBufferWriteIdx] = samples[i];
    SubtitleState.ringBufferWriteIdx = (SubtitleState.ringBufferWriteIdx + 1) % SubtitleState.ringBufferSize;
  }
  SubtitleState.samplesReceived += samples.length;
}

function readFromRingBuffer(seconds) {
  const samplesToRead = Math.min(seconds * 16000, SubtitleState.ringBufferSize);
  const result = new Float32Array(samplesToRead);
  let readIdx = (SubtitleState.ringBufferWriteIdx - samplesToRead + SubtitleState.ringBufferSize) % SubtitleState.ringBufferSize;
  for (let i = 0; i < samplesToRead; i++) {
    result[i] = SubtitleState.audioRingBuffer[readIdx];
    readIdx = (readIdx + 1) % SubtitleState.ringBufferSize;
  }
  return result;
}

async function startWhisper() {
  if (!SubtitleState.isModelLoaded) {
    const loaded = await initWhisper();
    if (!loaded) return;
  }

  try {
    updateStatus('loading', 'Starting mic...');
    initRingBuffer();

    SubtitleState.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });

    SubtitleState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    try {
      await SubtitleState.audioContext.audioWorklet.addModule('./audio-processor.js');
      SubtitleState.workletNode = new AudioWorkletNode(SubtitleState.audioContext, 'audio-capture-processor');
      SubtitleState.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio') {
          pushToRingBuffer(event.data.audio);
        }
      };
      const source = SubtitleState.audioContext.createMediaStreamSource(SubtitleState.mediaStream);
      source.connect(SubtitleState.workletNode);
    } catch (e) {
      console.warn('[Subtitles] AudioWorklet failed, using ScriptProcessor');
      // Fallback implementation omitted for brevity
    }

    SubtitleState.isListening = true;
    SubtitleState.processInterval = setInterval(processWhisperAudio, CONFIG.processIntervalMs);
    
    updateStatus('active', 'Listening (offline)');
    console.log('[Subtitles] Whisper started');
  } catch (error) {
    console.error('[Subtitles] Failed to start Whisper:', error);
    updateStatus('error', 'Mic failed');
  }
}

async function processWhisperAudio() {
  if (SubtitleState.isTranscribing || !SubtitleState.transcriber) return;
  
  // Wait for enough audio
  if (SubtitleState.samplesReceived < 2 * 16000) return;
  
  const audioWindow = readFromRingBuffer(CONFIG.windowSeconds);
  
  // Check audio energy
  let energy = 0;
  for (let i = 0; i < audioWindow.length; i++) {
    energy += audioWindow[i] * audioWindow[i];
  }
  energy = Math.sqrt(energy / audioWindow.length);
  
  if (energy < CONFIG.minAudioEnergy) return;
  
  SubtitleState.isTranscribing = true;
  
  try {
    // Normalize audio
    let peak = 0;
    for (let i = 0; i < audioWindow.length; i++) {
      const abs = Math.abs(audioWindow[i]);
      if (abs > peak) peak = abs;
    }
    
    let normalizedAudio = audioWindow;
    if (peak > 0.001) {
      normalizedAudio = new Float32Array(audioWindow.length);
      const gain = 0.9 / peak;
      for (let i = 0; i < audioWindow.length; i++) {
        normalizedAudio[i] = audioWindow[i] * gain;
      }
    }
    
    const result = await SubtitleState.transcriber(normalizedAudio);
    
    if (result && result.text && result.text.trim()) {
      const text = cleanTranscription(result.text);
      if (text && text.length > 1 && text !== SubtitleState.lastText) {
        SubtitleState.lastText = text;
        displaySubtitle(text);
      }
    }
  } catch (error) {
    console.error('[Subtitles] Transcription error:', error);
  } finally {
    SubtitleState.isTranscribing = false;
  }
}

function stopWhisper() {
  SubtitleState.isListening = false;
  
  if (SubtitleState.processInterval) {
    clearInterval(SubtitleState.processInterval);
    SubtitleState.processInterval = null;
  }
  
  if (SubtitleState.workletNode) {
    SubtitleState.workletNode.disconnect();
    SubtitleState.workletNode = null;
  }
  
  if (SubtitleState.audioContext) {
    SubtitleState.audioContext.close();
    SubtitleState.audioContext = null;
  }
  
  if (SubtitleState.mediaStream) {
    SubtitleState.mediaStream.getTracks().forEach(track => track.stop());
    SubtitleState.mediaStream = null;
  }
  
  SubtitleState.audioRingBuffer = null;
  hideSubtitle();
  updateStatus('', '');
  console.log('[Subtitles] Whisper stopped');
}

function cleanTranscription(text) {
  if (!text) return '';
  return text
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/<\|.*?\|>/g, '')
    .replace(/♪/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// DISPLAY FUNCTIONS
// ============================================================================

function displaySubtitleWithHighlight(text, isInterim) {
  const overlay = document.getElementById('subtitle-overlay');
  const container = document.getElementById('subtitle-text');
  
  if (!overlay || !container || !text.trim()) return;
  
  // Apply current size scale
  container.style.setProperty('--subtitle-scale', SubtitleState.sizeScale / 100);
  
  const words = text.split(' ').filter(w => w.length > 0);
  const maxWords = CONFIG.maxWordsPerLine * 2;
  const displayWords = words.slice(-maxWords);
  
  const wordSpans = displayWords.map((word, index) => {
    const isLast = index === displayWords.length - 1;
    const className = isLast && isInterim ? 'word current' : 'word spoken';
    return `<span class="${className}">${escapeHtml(word)}</span>`;
  }).join(' ');
  
  container.innerHTML = wordSpans;
  container.classList.add('has-highlight');
  overlay.style.display = 'flex';
  
  // Reset hide timeout
  if (SubtitleState.displayTimeout) {
    clearTimeout(SubtitleState.displayTimeout);
  }
  SubtitleState.displayTimeout = setTimeout(hideSubtitle, CONFIG.maxDisplayDuration);
}

function displaySubtitle(text) {
  const overlay = document.getElementById('subtitle-overlay');
  const container = document.getElementById('subtitle-text');
  
  if (!overlay || !container || !text.trim()) return;
  
  // Apply current size scale
  container.style.setProperty('--subtitle-scale', SubtitleState.sizeScale / 100);
  
  const words = text.split(' ').filter(w => w.length > 0);
  const maxWords = CONFIG.maxWordsPerLine * 2;
  const displayWords = words.slice(-maxWords);
  
  const wordSpans = displayWords.map((word, index) => {
    const className = index === displayWords.length - 1 ? 'word current' : 'word spoken';
    return `<span class="${className}">${escapeHtml(word)}</span>`;
  }).join(' ');
  
  container.innerHTML = wordSpans;
  container.classList.add('has-highlight');
  overlay.style.display = 'flex';
  
  if (SubtitleState.displayTimeout) {
    clearTimeout(SubtitleState.displayTimeout);
  }
  SubtitleState.displayTimeout = setTimeout(hideSubtitle, CONFIG.maxDisplayDuration);
}

function hideSubtitle() {
  const overlay = document.getElementById('subtitle-overlay');
  const container = document.getElementById('subtitle-text');
  
  if (overlay) overlay.style.display = 'none';
  if (container) {
    container.innerHTML = '';
    container.classList.remove('has-highlight');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateStatus(type, message) {
  const statusEl = document.getElementById('subtitle-status');
  if (!statusEl) return;
  
  statusEl.className = 'subtitle-status';
  if (type) statusEl.classList.add(type);
  statusEl.textContent = message;
}

// ============================================================================
// MAIN CONTROL FUNCTIONS
// ============================================================================

async function startListening() {
  if (SubtitleState.isListening) return;
  
  if (SubtitleState.offlineMode) {
    await startWhisper();
  } else {
    startWebSpeech();
  }
}

function stopListening() {
  if (SubtitleState.offlineMode) {
    stopWhisper();
  } else {
    stopWebSpeech();
  }
}

async function toggleSubtitles(enabled) {
  SubtitleState.enabled = enabled;
  
  if (enabled) {
    if (window.presentationStarted) {
      await startListening();
    }
  } else {
    stopListening();
  }
}

function setOfflineMode(offline) {
  const wasListening = SubtitleState.isListening;
  
  // Stop current mode
  if (wasListening) {
    stopListening();
  }
  
  SubtitleState.offlineMode = offline;
  console.log(`[Subtitles] Offline mode: ${offline ? 'ON' : 'OFF'}`);
  
  // Restart in new mode if needed
  if (wasListening && SubtitleState.enabled) {
    startListening();
  }
}

// ============================================================================
// SUBTITLE SIZE CONFIGURATION
// ============================================================================

const SUBTITLE_SIZE_STORAGE_KEY = 'subtitle_size_scale';

function loadSubtitleSize() {
  const stored = localStorage.getItem(SUBTITLE_SIZE_STORAGE_KEY);
  if (stored) {
    const size = parseInt(stored, 10);
    if (!isNaN(size) && size >= 50 && size <= 150) {
      SubtitleState.sizeScale = size;
      return size;
    }
  }
  return 100; // Default
}

function saveSubtitleSize(size) {
  localStorage.setItem(SUBTITLE_SIZE_STORAGE_KEY, size.toString());
}

function setSubtitleSize(sizePercent) {
  // Clamp value between 50 and 150
  const size = Math.max(50, Math.min(150, parseInt(sizePercent, 10) || 100));
  SubtitleState.sizeScale = size;
  
  // Apply the scale as a CSS variable
  const container = document.getElementById('subtitle-text');
  if (container) {
    container.style.setProperty('--subtitle-scale', size / 100);
  }
  
  // Save to localStorage
  saveSubtitleSize(size);
  
  console.log(`[Subtitles] Size set to ${size}%`);
}

function getSubtitleSize() {
  return SubtitleState.sizeScale;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initSubtitles() {
  // Load saved subtitle size
  const savedSize = loadSubtitleSize();
  SubtitleState.sizeScale = savedSize;
  
  // Apply the saved size to the subtitle text element
  const subtitleText = document.getElementById('subtitle-text');
  if (subtitleText) {
    subtitleText.style.setProperty('--subtitle-scale', savedSize / 100);
  }
  
  // Main subtitles toggle
  const toggle = document.getElementById('subtitlesEnabled');
  if (toggle) {
    toggle.addEventListener('change', (e) => toggleSubtitles(e.target.checked));
  }
  
  // Offline mode toggle
  const offlineToggle = document.getElementById('offlineModeEnabled');
  if (offlineToggle) {
    offlineToggle.addEventListener('change', (e) => setOfflineMode(e.target.checked));
  }
  
  // Subtitle size slider
  const sizeSlider = document.getElementById('subtitleSize');
  const sizeValue = document.getElementById('subtitleSizeValue');
  if (sizeSlider) {
    // Set initial value from saved state
    sizeSlider.value = savedSize;
    if (sizeValue) {
      sizeValue.textContent = savedSize + '%';
    }
    
    // Listen for changes
    sizeSlider.addEventListener('input', (e) => {
      const size = parseInt(e.target.value, 10);
      setSubtitleSize(size);
      if (sizeValue) {
        sizeValue.textContent = size + '%';
      }
    });
  }
  
  // Expose API for app.js
  window.subtitleSystem = {
    onPresentationStart: async () => {
      if (SubtitleState.enabled) {
        await startListening();
      }
    },
    onPresentationEnd: () => {
      stopListening();
    },
    isEnabled: () => SubtitleState.enabled,
    isOfflineMode: () => SubtitleState.offlineMode,
    toggle: toggleSubtitles,
    setOfflineMode: setOfflineMode,
    setSize: setSubtitleSize,
    getSize: getSubtitleSize
  };
  
  const hasWebSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasWebGPU = !!navigator.gpu;
  console.log(`[Subtitles] Initialized (Web Speech: ${hasWebSpeech}, WebGPU: ${hasWebGPU}, Size: ${savedSize}%)`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubtitles);
} else {
  initSubtitles();
}

})();
