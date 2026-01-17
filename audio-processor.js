/**
 * AudioWorklet Processor for capturing and downsampling audio
 * 
 * Runs on a dedicated audio thread, isolated from main UI thread.
 * Downsamples from native sample rate (usually 48kHz) to 16kHz for speech models.
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.bufferSize = 4800; // 300ms at 16kHz - good chunk size for VAD
    this.inputSampleRate = sampleRate; // Global from AudioWorkletGlobalScope
    this.outputSampleRate = 16000;
    this.resampleRatio = this.inputSampleRate / this.outputSampleRate;
    this.resampleAccumulator = 0;
    this.chunkCount = 0;
    this.peakLevel = 0;
    
    console.log(`[AudioProcessor] Initialized: ${this.inputSampleRate}Hz -> ${this.outputSampleRate}Hz (ratio: ${this.resampleRatio})`);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) {
      return true;
    }

    const channelData = input[0]; // Mono
    
    // Track peak level for debugging
    for (let i = 0; i < channelData.length; i++) {
      const abs = Math.abs(channelData[i]);
      if (abs > this.peakLevel) this.peakLevel = abs;
    }
    
    // Downsample using linear interpolation
    for (let i = 0; i < channelData.length; i++) {
      this.resampleAccumulator += 1;
      
      if (this.resampleAccumulator >= this.resampleRatio) {
        this.resampleAccumulator -= this.resampleRatio;
        // Store the sample value directly
        this.buffer.push(channelData[i]);
        
        // Send chunk when buffer is full
        if (this.buffer.length >= this.bufferSize) {
          this.chunkCount++;
          
          // Log every 10th chunk for monitoring
          if (this.chunkCount <= 3 || this.chunkCount % 10 === 0) {
            console.log(`[AudioProcessor] Chunk ${this.chunkCount}: ${this.buffer.length} samples, peak=${this.peakLevel.toFixed(4)}`);
          }
          
          this.port.postMessage({
            type: 'audio',
            audio: new Float32Array(this.buffer),
            peak: this.peakLevel
          });
          this.buffer = [];
          this.peakLevel = 0;
        }
      }
    }
    
    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
