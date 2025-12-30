// ============================================================================
// WAV RECORDER
// Record audio output from patches to WAV files
// ============================================================================

import { WavEncoder } from './wav-encoder.js';

// AudioWorklet processor code for recording
const RECORDER_PROCESSOR_CODE = `
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRecording = false;
    this.bufferL = [];
    this.bufferR = [];
    this.maxDuration = 60 * 60; // 1 hour max
    this.maxSamples = this.maxDuration * sampleRate;

    this.port.onmessage = (e) => {
      switch (e.data.type) {
        case 'start':
          this.isRecording = true;
          this.bufferL = [];
          this.bufferR = [];
          break;
        case 'stop':
          this.isRecording = false;
          // Send recorded data back
          this.port.postMessage({
            type: 'complete',
            left: new Float32Array(this.bufferL),
            right: new Float32Array(this.bufferR),
            sampleRate: sampleRate
          });
          this.bufferL = [];
          this.bufferR = [];
          break;
        case 'getStatus':
          this.port.postMessage({
            type: 'status',
            isRecording: this.isRecording,
            samples: this.bufferL.length,
            duration: this.bufferL.length / sampleRate
          });
          break;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    // Pass through audio
    const output = outputs[0];
    for (let ch = 0; ch < output.length; ch++) {
      output[ch].set(input[ch] || input[0]);
    }

    // Record if active
    if (this.isRecording && this.bufferL.length < this.maxSamples) {
      const left = input[0];
      const right = input[1] || input[0];

      for (let i = 0; i < left.length; i++) {
        this.bufferL.push(left[i]);
        this.bufferR.push(right[i]);
      }
    }

    return true;
  }
}

registerProcessor('wav-recorder-processor', RecorderProcessor);
`;

class WavRecorder {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.recorderNode = null;
    this.isRecording = false;
    this.startTime = null;
    this.recordingPromise = null;
    this.resolveRecording = null;

    // Recording metadata
    this.patchInfo = {
      name: 'recording',
      key: null,
      scale: null,
      bpm: null
    };

    // Callbacks
    this.onStart = null;
    this.onStop = null;
    this.onTimeUpdate = null;

    this._timeUpdateInterval = null;
  }

  async init() {
    // Create blob URL for processor
    const blob = new Blob([RECORDER_PROCESSOR_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      await this.audioContext.audioWorklet.addModule(url);
    } catch (e) {
      if (!e.message.includes('already been added')) {
        console.error('Failed to load recorder processor:', e);
        throw e;
      }
    }

    URL.revokeObjectURL(url);

    // Create recorder node
    this.recorderNode = new AudioWorkletNode(this.audioContext, 'wav-recorder-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    // Handle messages from processor
    this.recorderNode.port.onmessage = (e) => {
      if (e.data.type === 'complete') {
        this._handleRecordingComplete(e.data);
      } else if (e.data.type === 'status') {
        // Handle status updates if needed
      }
    };

    return this;
  }

  /**
   * Get the recorder node to insert in audio chain
   * Connect: source -> recorder -> destination
   */
  get node() {
    return this.recorderNode;
  }

  /**
   * Set patch metadata for filename
   */
  setPatchInfo(info) {
    this.patchInfo = { ...this.patchInfo, ...info };
  }

  /**
   * Start recording
   */
  start() {
    if (this.isRecording) return;

    this.isRecording = true;
    this.startTime = Date.now();

    this.recorderNode.port.postMessage({ type: 'start' });

    // Start time update interval
    this._timeUpdateInterval = setInterval(() => {
      if (this.onTimeUpdate) {
        const elapsed = (Date.now() - this.startTime) / 1000;
        this.onTimeUpdate(elapsed);
      }
    }, 100);

    // Create promise for recording completion
    this.recordingPromise = new Promise(resolve => {
      this.resolveRecording = resolve;
    });

    if (this.onStart) {
      this.onStart();
    }

    return this.recordingPromise;
  }

  /**
   * Stop recording and get WAV blob
   */
  stop() {
    if (!this.isRecording) return null;

    this.isRecording = false;

    // Clear time update interval
    if (this._timeUpdateInterval) {
      clearInterval(this._timeUpdateInterval);
      this._timeUpdateInterval = null;
    }

    // Tell processor to stop and send data
    this.recorderNode.port.postMessage({ type: 'stop' });

    return this.recordingPromise;
  }

  _handleRecordingComplete(data) {
    const { left, right, sampleRate } = data;

    // Encode to WAV
    const wavBlob = WavEncoder.encode([left, right], sampleRate, 16);

    // Generate filename
    const filename = this._generateFilename();

    if (this.onStop) {
      this.onStop(wavBlob, filename);
    }

    if (this.resolveRecording) {
      this.resolveRecording({ blob: wavBlob, filename });
      this.resolveRecording = null;
    }
  }

  _generateFilename() {
    const { name, key, scale, bpm } = this.patchInfo;

    // Format timestamp
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .slice(0, 19);

    // Build filename parts
    const parts = [name];

    if (key) parts.push(key);
    if (scale) parts.push(scale);
    if (bpm) parts.push(`${bpm}bpm`);

    parts.push(timestamp);

    return parts.join('_') + '.wav';
  }

  /**
   * Get current recording duration
   */
  getDuration() {
    if (!this.isRecording || !this.startTime) return 0;
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * Format seconds to HH:MM:SS
   */
  static formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Download a WAV blob
   */
  static download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Cleanup
   */
  dispose() {
    if (this._timeUpdateInterval) {
      clearInterval(this._timeUpdateInterval);
    }
    if (this.recorderNode) {
      this.recorderNode.disconnect();
      this.recorderNode.port.close();
    }
  }
}

// Export
if (typeof window !== 'undefined') {
  window.WavRecorder = WavRecorder;
}

export { WavRecorder };
