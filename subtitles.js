/**
 * Live Subtitles using Whisper + WebGPU
 * 
 * Key insights from research:
 * - Whisper needs 10-15s context, not 2.5s chunks
 * - Use sliding window: 15s buffer, process every 1.5s
 * - Use timestamps to dedupe and show only new text
 * - Use onnx-community model for WebGPU compatibility
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
  
  // Sliding window buffer (15 seconds at 16kHz = 240,000 samples)
  audioRingBuffer: null,
  ringBufferWriteIdx: 0,
  ringBufferSize: 15 * 16000, // 15 seconds
  
  // Processing state
  isTranscribing: false,
  processInterval: null,
  lastTranscribedText: '',
  lastTimestamp: 0,
  
  displayTimeout: null
};

// Configuration
const CONFIG = {
  // Xenova model works with our transformers.js version
  modelName: 'Xenova/whisper-tiny.en',
  
  // Sliding window parameters (from research)
  windowSeconds: 15,        // Full context window
  processIntervalMs: 1500,  // Process every 1.5 seconds
  minAudioEnergy: 0.003,    // Lower threshold
  stableDelaySeconds: 1,    // Only finalize text older than this
  
  maxDisplayDuration: 6000,
  maxWordsPerLine: 12,
  debug: true
};

/**
 * Initialize the ring buffer
 */
function initRingBuffer() {
  SubtitleState.audioRingBuffer = new Float32Array(SubtitleState.ringBufferSize);
  SubtitleState.ringBufferWriteIdx = 0;
}

/**
 * Push audio samples into the ring buffer
 */
function pushToRingBuffer(samples) {
  for (let i = 0; i < samples.length; i++) {
    SubtitleState.audioRingBuffer[SubtitleState.ringBufferWriteIdx] = samples[i];
    SubtitleState.ringBufferWriteIdx = (SubtitleState.ringBufferWriteIdx + 1) % SubtitleState.ringBufferSize;
  }
}

/**
 * Read the last N seconds from ring buffer (returns contiguous array)
 */
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

/**
 * Dynamically import transformers.js
 */
async function loadTransformers() {
  const module = await import('./lib/transformers/transformers.min.js');
  
  // Configure paths
  module.env.backends.onnx.wasm.wasmPaths = './lib/transformers/';
  module.env.allowLocalModels = false;
  
  return module;
}

/**
 * Initialize Whisper model with WebGPU
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
    let device = 'wasm';
    let useWebGPU = false;
    
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          console.log('[Subtitles] WebGPU adapter found');
          device = 'webgpu';
          useWebGPU = true;
        }
      } catch (e) {
        console.warn('[Subtitles] WebGPU not usable:', e.message);
      }
    }
    
    if (!useWebGPU) {
      console.log('[Subtitles] Using WASM backend (WebGPU not available)');
    }

    console.log(`[Subtitles] Loading ${CONFIG.modelName} on ${device}...`);
    updateStatus('loading', `Loading on ${device}...`);
    
    const startLoad = performance.now();
    
    SubtitleState.transcriber = await pipeline(
      'automatic-speech-recognition',
      CONFIG.modelName,
      {
        device: device,
        dtype: useWebGPU ? 'fp32' : 'q8',
        progress_callback: (progress) => {
          if (progress.status === 'progress' && progress.progress) {
            const percent = Math.round(progress.progress);
            updateStatus('loading', `Downloading: ${percent}%`);
          } else if (progress.status === 'ready') {
            updateStatus('loading', 'Initializing...');
          }
        }
      }
    );

    const loadTime = performance.now() - startLoad;
    SubtitleState.isModelLoaded = true;
    SubtitleState.isModelLoading = false;
    
    console.log(`[Subtitles] Model loaded in ${Math.round(loadTime)}ms on ${device}`);
    updateStatus('', '');
    
    // Warm up the model with a dummy inference
    if (useWebGPU) {
      console.log('[Subtitles] Warming up WebGPU...');
      const dummy = new Float32Array(16000); // 1 second of silence
      await SubtitleState.transcriber(dummy, { return_timestamps: false });
      console.log('[Subtitles] Warmup complete');
    }
    
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
    
    // Initialize ring buffer
    initRingBuffer();
    
    // Get microphone
    SubtitleState.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    SubtitleState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const actualSampleRate = SubtitleState.audioContext.sampleRate;
    console.log(`[Subtitles] AudioContext sample rate: ${actualSampleRate}Hz`);

    // Try AudioWorklet first
    let useWorklet = false;
    try {
      await SubtitleState.audioContext.audioWorklet.addModule('./audio-processor.js');
      useWorklet = true;
      console.log('[Subtitles] Using AudioWorklet');
    } catch (e) {
      console.warn('[Subtitles] AudioWorklet failed, using ScriptProcessor:', e);
    }

    const source = SubtitleState.audioContext.createMediaStreamSource(SubtitleState.mediaStream);

    if (useWorklet) {
      SubtitleState.workletNode = new AudioWorkletNode(SubtitleState.audioContext, 'audio-capture-processor');
      SubtitleState.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio') {
          pushToRingBuffer(event.data.audio);
        }
      };
      source.connect(SubtitleState.workletNode);
    } else {
      // Fallback to ScriptProcessor
      const inputRate = actualSampleRate;
      const outputRate = 16000;
      const ratio = inputRate / outputRate;
      let accumulator = 0;
      
      const processor = SubtitleState.audioContext.createScriptProcessor(4096, 1, 1);
      const tempBuffer = [];
      
      processor.onaudioprocess = (event) => {
        if (!SubtitleState.isListening) return;
        const input = event.inputBuffer.getChannelData(0);
        
        for (let i = 0; i < input.length; i++) {
          accumulator += 1;
          if (accumulator >= ratio) {
            accumulator -= ratio;
            tempBuffer.push(input[i]);
          }
        }
        
        if (tempBuffer.length >= 1600) { // 100ms chunks
          pushToRingBuffer(new Float32Array(tempBuffer));
          tempBuffer.length = 0;
        }
      };

      source.connect(processor);
      processor.connect(SubtitleState.audioContext.destination);
      SubtitleState.processor = processor;
    }

    SubtitleState.isListening = true;
    SubtitleState.lastTranscribedText = '';
    SubtitleState.lastTimestamp = 0;

    // Start processing loop
    SubtitleState.processInterval = setInterval(() => {
      processAudioWindow();
    }, CONFIG.processIntervalMs);

    updateStatus('active', 'Listening...');
    console.log('[Subtitles] Started listening');

  } catch (error) {
    console.error('[Subtitles] Failed to start:', error);
    updateStatus('error', 'Mic failed');
    throw error;
  }
}

/**
 * Process the sliding audio window
 */
async function processAudioWindow() {
  if (SubtitleState.isTranscribing || !SubtitleState.transcriber) {
    return;
  }

  // Read last 15 seconds from ring buffer
  const audioWindow = readFromRingBuffer(CONFIG.windowSeconds);
  
  // Check energy of recent audio (last 2 seconds)
  const recentAudio = readFromRingBuffer(2);
  const energy = calculateEnergy(recentAudio);
  
  if (energy < CONFIG.minAudioEnergy) {
    if (CONFIG.debug) console.log(`[Subtitles] Quiet (energy: ${energy.toFixed(5)})`);
    return;
  }

  SubtitleState.isTranscribing = true;
  
  try {
    const startTime = performance.now();
    
    // Transcribe the audio window
    const result = await SubtitleState.transcriber(audioWindow, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      language: 'en',
      task: 'transcribe'
    });

    const processingTime = performance.now() - startTime;
    
    if (CONFIG.debug) {
      console.log(`[Subtitles] Processed in ${Math.round(processingTime)}ms, result:`, result);
    }

    if (result) {
      handleTranscriptionResult(result, processingTime);
    } else {
      console.log('[Subtitles] No result returned');
    }
  } catch (error) {
    console.error('[Subtitles] Transcription error:', error);
  } finally {
    SubtitleState.isTranscribing = false;
  }
}

/**
 * Handle transcription result with deduplication
 */
function handleTranscriptionResult(result, processingTime) {
  // Get the text from result
  let text = result.text || '';
  
  if (CONFIG.debug && result.chunks) {
    console.log(`[Subtitles] Chunks:`, result.chunks);
  }
  
  // Clean the text
  text = cleanTranscription(text);
  
  if (CONFIG.debug) {
    console.log(`[Subtitles] Cleaned text: "${text}"`);
  }
  
  if (!text || text.length < 2) {
    if (CONFIG.debug) console.log('[Subtitles] Text too short, skipping');
    return;
  }

  // Simple deduplication: don't show exact same text
  if (text === SubtitleState.lastTranscribedText) {
    if (CONFIG.debug) console.log('[Subtitles] Duplicate, skipping');
    return;
  }
  
  console.log(`[Subtitles] (${Math.round(processingTime)}ms) "${text}"`);
  SubtitleState.lastTranscribedText = text;
  displaySubtitle(text);
}

/**
 * Calculate RMS energy
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

  if (SubtitleState.processInterval) {
    clearInterval(SubtitleState.processInterval);
    SubtitleState.processInterval = null;
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

  SubtitleState.audioRingBuffer = null;
  hideSubtitle();
  updateStatus('', '');
  
  console.log('[Subtitles] Stopped');
}

/**
 * Clean transcription text
 */
function cleanTranscription(text) {
  if (!text) return '';
  
  let clean = text
    .replace(/\[.*?\]/g, '')      // [MUSIC] etc
    .replace(/\(.*?\)/g, '')      // (inaudible) etc
    .replace(/<\|.*?\|>/g, '')    // Whisper tokens
    .replace(/♪/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Only filter very specific hallucinations (keep most text)
  const hallucinations = [
    'thank you for watching',
    'thanks for watching', 
    'please subscribe',
    'like and subscribe'
  ];
  
  if (hallucinations.includes(clean.toLowerCase())) {
    return '';
  }
  
  return clean;
}

/**
 * Display subtitle
 */
function displaySubtitle(text) {
  const overlay = document.getElementById('subtitle-overlay');
  const container = document.getElementById('subtitle-text');
  
  if (!overlay || !container || !text.trim()) return;
  
  const words = text.split(' ').filter(w => w.length > 0);
  const wrappedWords = wrapTextToFitScreen(words);
  
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
  
  const hasWebGPU = !!navigator.gpu;
  console.log(`[Subtitles] Initialized (WebGPU: ${hasWebGPU ? 'detected' : 'not detected'})`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubtitles);
} else {
  initSubtitles();
}

})();
