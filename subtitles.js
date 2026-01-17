/**
 * Live Subtitles using Transformers.js + WebGPU
 * 
 * Based on research recommendations:
 * - AudioWorklet for glitch-free capture (not deprecated ScriptProcessorNode)
 * - WebGPU acceleration for 5-75x faster inference
 * - Proper downsampling from 48kHz to 16kHz
 * - Energy-based VAD to skip silence
 */

(function() {
'use strict';

// State
const SubtitleState = {
  transcriber: null,
  isModelLoaded: false,
  isModelLoading: false,
  isListening: false,
  enabled: false,
  audioContext: null,
  mediaStream: null,
  workletNode: null,
  audioBuffer: [],
  isTranscribing: false,
  displayTimeout: null,
  processTimeout: null
};

// Configuration
const CONFIG = {
  modelName: 'Xenova/whisper-tiny.en',
  useWebGPU: true,
  chunkDurationMs: 2500,      // Process every 2.5 seconds
  minAudioEnergy: 0.005,      // Skip chunks below this energy level
  maxDisplayDuration: 5000,
  maxWordsPerLine: 12,
  debug: true
};

/**
 * Dynamically import transformers.js
 */
async function loadTransformers() {
  const { pipeline, env } = await import('./lib/transformers/transformers.min.js');
  
  // Configure paths
  env.backends.onnx.wasm.wasmPaths = './lib/transformers/';
  env.allowLocalModels = false;
  
  return { pipeline, env };
}

/**
 * Initialize Whisper model with WebGPU if available
 */
async function initializeWhisper() {
  if (SubtitleState.isModelLoaded || SubtitleState.isModelLoading) {
    return SubtitleState.isModelLoaded;
  }

  SubtitleState.isModelLoading = true;
  updateStatus('loading', 'Loading model...');

  try {
    const { pipeline } = await loadTransformers();
    
    // Check WebGPU availability
    let device = 'wasm'; // fallback
    if (CONFIG.useWebGPU && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          device = 'webgpu';
          console.log('[Subtitles] WebGPU available - using GPU acceleration');
        }
      } catch (e) {
        console.log('[Subtitles] WebGPU not available, falling back to WASM');
      }
    }

    console.log(`[Subtitles] Loading ${CONFIG.modelName} on ${device}...`);
    
    SubtitleState.transcriber = await pipeline(
      'automatic-speech-recognition',
      CONFIG.modelName,
      {
        device: device,
        dtype: device === 'webgpu' ? 'fp32' : 'q8', // FP32 for WebGPU, quantized for WASM
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
    console.log(`[Subtitles] Model loaded on ${device}`);
    updateStatus('', '');
    return true;
  } catch (error) {
    console.error('[Subtitles] Failed to load model:', error);
    SubtitleState.isModelLoading = false;
    updateStatus('error', 'Model load failed');
    throw error;
  }
}

/**
 * Start listening with AudioWorklet
 */
async function startListening() {
  if (SubtitleState.isListening) return;

  try {
    updateStatus('loading', 'Starting mic...');
    
    // Get microphone
    SubtitleState.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Create audio context (let browser choose sample rate)
    SubtitleState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    const actualSampleRate = SubtitleState.audioContext.sampleRate;
    console.log(`[Subtitles] AudioContext sample rate: ${actualSampleRate}Hz`);

    // Load AudioWorklet
    try {
      await SubtitleState.audioContext.audioWorklet.addModule('./audio-processor.js');
      console.log('[Subtitles] AudioWorklet loaded');
    } catch (workletError) {
      console.warn('[Subtitles] AudioWorklet failed, falling back to ScriptProcessor:', workletError);
      return startListeningFallback();
    }

    // Create source and worklet node
    const source = SubtitleState.audioContext.createMediaStreamSource(SubtitleState.mediaStream);
    SubtitleState.workletNode = new AudioWorkletNode(SubtitleState.audioContext, 'audio-capture-processor');

    // Handle audio chunks from worklet
    SubtitleState.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'audio') {
        SubtitleState.audioBuffer.push(...event.data.audio);
      }
    };

    source.connect(SubtitleState.workletNode);
    // Don't connect to destination - we don't want to hear ourselves
    
    SubtitleState.isListening = true;
    SubtitleState.audioBuffer = [];

    // Start processing loop
    scheduleProcessing();

    updateStatus('active', 'Listening...');
    console.log('[Subtitles] Started with AudioWorklet');

  } catch (error) {
    console.error('[Subtitles] Failed to start:', error);
    updateStatus('error', 'Mic failed');
    throw error;
  }
}

/**
 * Fallback to ScriptProcessor if AudioWorklet fails
 */
function startListeningFallback() {
  const source = SubtitleState.audioContext.createMediaStreamSource(SubtitleState.mediaStream);
  
  // Downsampling parameters
  const inputRate = SubtitleState.audioContext.sampleRate;
  const outputRate = 16000;
  const ratio = inputRate / outputRate;
  let accumulator = 0;
  
  const processor = SubtitleState.audioContext.createScriptProcessor(4096, 1, 1);
  
  processor.onaudioprocess = (event) => {
    if (!SubtitleState.isListening) return;
    
    const input = event.inputBuffer.getChannelData(0);
    
    // Downsample
    for (let i = 0; i < input.length; i++) {
      accumulator += 1;
      if (accumulator >= ratio) {
        accumulator -= ratio;
        SubtitleState.audioBuffer.push(input[i]);
      }
    }
  };

  source.connect(processor);
  processor.connect(SubtitleState.audioContext.destination);
  
  SubtitleState.processor = processor;
  SubtitleState.isListening = true;
  SubtitleState.audioBuffer = [];

  scheduleProcessing();

  updateStatus('active', 'Listening (fallback)...');
  console.log('[Subtitles] Started with ScriptProcessor fallback');
}

/**
 * Schedule periodic audio processing
 */
function scheduleProcessing() {
  SubtitleState.processTimeout = setTimeout(async () => {
    if (SubtitleState.isListening) {
      await processAudioBuffer();
      scheduleProcessing();
    }
  }, CONFIG.chunkDurationMs);
}

/**
 * Process accumulated audio buffer
 */
async function processAudioBuffer() {
  if (SubtitleState.isTranscribing || SubtitleState.audioBuffer.length < 8000) {
    return; // Need at least 0.5s of audio
  }

  // Take current buffer
  const audioData = new Float32Array(SubtitleState.audioBuffer);
  SubtitleState.audioBuffer = [];

  // Check energy level (simple VAD)
  const energy = calculateEnergy(audioData);
  if (energy < CONFIG.minAudioEnergy) {
    if (CONFIG.debug) console.log(`[Subtitles] Skipping quiet audio (energy: ${energy.toFixed(5)})`);
    return;
  }

  if (CONFIG.debug) console.log(`[Subtitles] Processing ${(audioData.length / 16000).toFixed(2)}s audio (energy: ${energy.toFixed(5)})`);

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
      
      if (text && text.length > 1) {
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
 * Calculate RMS energy of audio
 */
function calculateEnergy(audioData) {
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

  if (SubtitleState.processTimeout) {
    clearTimeout(SubtitleState.processTimeout);
    SubtitleState.processTimeout = null;
  }

  if (SubtitleState.workletNode) {
    SubtitleState.workletNode.disconnect();
    SubtitleState.workletNode = null;
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
  
  // Filter hallucinations
  const hallucinations = [
    'thank you', 'thanks for watching', 'subscribe', 'like and subscribe',
    'see you', 'bye', 'goodbye', 'you', 'the end', 'thanks', ''
  ];
  
  if (hallucinations.includes(clean.toLowerCase())) {
    return '';
  }
  
  if (clean.length > 0) {
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  
  return clean;
}

/**
 * Display subtitle with current word highlighted
 */
function displaySubtitle(text) {
  const overlay = document.getElementById('subtitle-overlay');
  const container = document.getElementById('subtitle-text');
  
  if (!overlay || !container || !text.trim()) return;
  
  const words = text.split(' ').filter(w => w.length > 0);
  const wrappedWords = wrapTextToFitScreen(words);
  
  // Last word is "current", previous are "spoken"
  const wordSpans = wrappedWords.map((word, index) => {
    const className = index === wrappedWords.length - 1 ? 'word current' : 'word spoken';
    return `<span class="${className}">${escapeHtml(word)}</span>`;
  }).join(' ');
  
  container.innerHTML = wordSpans;
  container.classList.add('has-highlight', 'new-text');
  overlay.style.display = 'flex';
  
  setTimeout(() => container.classList.remove('new-text'), 300);
  
  if (SubtitleState.displayTimeout) {
    clearTimeout(SubtitleState.displayTimeout);
  }
  
  SubtitleState.displayTimeout = setTimeout(hideSubtitle, CONFIG.maxDisplayDuration);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function wrapTextToFitScreen(words) {
  const maxChars = Math.floor(window.innerWidth / 22);
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

function hideSubtitle() {
  const overlay = document.getElementById('subtitle-overlay');
  const container = document.getElementById('subtitle-text');
  
  if (overlay) overlay.style.display = 'none';
  if (container) {
    container.innerHTML = '';
    container.classList.remove('has-highlight');
  }
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
  
  // Check WebGPU support
  const hasWebGPU = !!navigator.gpu;
  console.log(`[Subtitles] Initialized (WebGPU: ${hasWebGPU ? 'available' : 'not available'})`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubtitles);
} else {
  initSubtitles();
}

})();
