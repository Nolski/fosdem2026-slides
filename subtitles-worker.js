/**
 * Whisper Transcription Web Worker
 * 
 * Runs speech recognition in a background thread to avoid blocking the UI.
 */

import { pipeline, env } from './lib/transformers/transformers.min.js';

// Configure transformers.js
env.allowLocalModels = false;

let transcriber = null;
let isLoading = false;

/**
 * Initialize the Whisper model
 */
async function initModel(modelName) {
  if (transcriber || isLoading) return;
  
  isLoading = true;
  self.postMessage({ type: 'status', status: 'loading', message: 'Loading AI model...' });

  try {
    transcriber = await pipeline(
      'automatic-speech-recognition',
      modelName,
      {
        quantized: true,
        progress_callback: (progress) => {
          if (progress.status === 'downloading') {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            self.postMessage({ type: 'status', status: 'loading', message: `Downloading: ${percent}%` });
          } else if (progress.status === 'loading') {
            self.postMessage({ type: 'status', status: 'loading', message: 'Initializing...' });
          }
        }
      }
    );
    
    isLoading = false;
    self.postMessage({ type: 'status', status: 'ready', message: 'Ready' });
    self.postMessage({ type: 'model-loaded' });
  } catch (error) {
    isLoading = false;
    self.postMessage({ type: 'status', status: 'error', message: error.message });
    self.postMessage({ type: 'error', error: error.message });
  }
}

/**
 * Transcribe audio data
 */
async function transcribe(audioData, sampleRate) {
  if (!transcriber) {
    self.postMessage({ type: 'error', error: 'Model not loaded' });
    return;
  }

  try {
    const startTime = performance.now();
    
    // Convert to Float32Array if needed
    const audio = audioData instanceof Float32Array ? audioData : new Float32Array(audioData);
    
    // Run transcription with optimized settings for speed
    const result = await transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      language: 'english',
      task: 'transcribe'
    });

    const processingTime = performance.now() - startTime;

    if (result && result.text) {
      const text = result.text.trim();
      if (text && text.length > 0) {
        self.postMessage({ 
          type: 'transcription', 
          text: text,
          processingTime: processingTime
        });
      }
    }
  } catch (error) {
    console.error('Transcription error:', error);
    self.postMessage({ type: 'error', error: error.message });
  }
}

// Handle messages from main thread
self.onmessage = async function(event) {
  const { type, data } = event.data;
  
  switch (type) {
    case 'init':
      await initModel(data.modelName);
      break;
    case 'transcribe':
      await transcribe(data.audio, data.sampleRate);
      break;
    case 'ping':
      self.postMessage({ type: 'pong' });
      break;
  }
};
