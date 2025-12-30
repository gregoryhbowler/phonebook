// ============================================================================
// MIMEOPHON ADAPTER
// Adapts the standalone Mimeophon effect for use in the pedalboard system
// ============================================================================

import { ExternalEffectWrapper, registerExternalEffect } from '../effect-wrapper.js';

/**
 * Mimeophon-inspired stereo delay effect adapter
 * Provides zone-based delay times, feedback coloration, and special modes
 */
export class MimeophonAdapter extends ExternalEffectWrapper {
  static get id() { return 'mimeophon'; }
  static get name() { return 'Mimeophon'; }
  static get category() { return 'Advanced'; }

  static get params() {
    return {
      zone: {
        min: 0, max: 3, default: 1, step: 1,
        label: 'Zone',
        options: ['A (5-50ms)', 'B (50-400ms)', 'C (0.4-2s)', 'D (2-10s)']
      },
      rate: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Rate' },
      microRate: { min: 0, max: 1, default: 0, step: 0.01, label: 'Micro Rate' },
      microRateFreq: { min: 0.1, max: 8, default: 2, step: 0.1, label: 'MRate Freq' },
      skew: { min: -1, max: 1, default: 0, step: 0.01, label: 'Skew' },
      repeats: { min: 0, max: 1.2, default: 0.3, step: 0.01, label: 'Repeats' },
      color: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Color' },
      halo: { min: 0, max: 1, default: 0, step: 0.01, label: 'Halo' },
      mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' },
      hold: { min: 0, max: 1, default: 0, step: 1, label: 'Hold', options: ['Off', 'On'] },
      flip: { min: 0, max: 1, default: 0, step: 1, label: 'Flip', options: ['Off', 'On'] },
      pingPong: { min: 0, max: 1, default: 0, step: 1, label: 'Ping-Pong', options: ['Off', 'On'] },
      swap: { min: 0, max: 1, default: 0, step: 1, label: 'Swap', options: ['Off', 'On'] }
    };
  }

  constructor(audioContext, slot = 0) {
    super('mimeophon', audioContext, slot);
    this.workletNode = null;
    this.audioParams = {}; // AudioParam references
  }

  get input() {
    return this._inputGain;
  }

  get output() {
    return this._outputGain;
  }

  async initialize() {
    try {
      // Register the processor using inline blob URL
      await this.ctx.audioWorklet.addModule(this._getProcessorURL());

      // Create the worklet node
      this.workletNode = new AudioWorkletNode(this.ctx, 'mimeophon-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          sampleRate: this.ctx.sampleRate
        }
      });

      // Store AudioParam references
      this.audioParams = {
        zone: this.workletNode.parameters.get('zone'),
        rate: this.workletNode.parameters.get('rate'),
        microRate: this.workletNode.parameters.get('microRate'),
        microRateFreq: this.workletNode.parameters.get('microRateFreq'),
        skew: this.workletNode.parameters.get('skew'),
        repeats: this.workletNode.parameters.get('repeats'),
        color: this.workletNode.parameters.get('color'),
        halo: this.workletNode.parameters.get('halo'),
        mix: this.workletNode.parameters.get('mix'),
        hold: this.workletNode.parameters.get('hold'),
        flip: this.workletNode.parameters.get('flip'),
        pingPong: this.workletNode.parameters.get('pingPong'),
        swap: this.workletNode.parameters.get('swap')
      };

      // Initialize param values from defaults
      const paramDefs = MimeophonAdapter.params;
      for (const [name, def] of Object.entries(paramDefs)) {
        this.params[name] = def.default;
      }

      // Connect audio routing
      // Wet path: Input -> worklet -> output
      this._inputGain.connect(this.workletNode);
      this.workletNode.connect(this._outputGain);

      // Dry/bypass path: Input -> bypassGain -> output
      this._inputGain.connect(this._bypassGain);
      this._bypassGain.connect(this._outputGain);

      this.isInitialized = true;
      return this;

    } catch (error) {
      console.error('MimeophonAdapter: Failed to initialize:', error);
      throw error;
    }
  }

  setParam(name, value) {
    this.params[name] = value;

    // Set the AudioParam value
    if (this.audioParams[name]) {
      this.audioParams[name].setValueAtTime(value, this.ctx.currentTime);
    }

    if (this.onParamChange) {
      this.onParamChange(name, value);
    }
  }

  bypass(state) {
    this.isBypassed = state;
    const now = this.ctx.currentTime;
    const rampTime = 0.02;

    if (state) {
      // Bypass on: mute effect output, let dry signal through
      // We do this by setting mix to 0 effectively, but keep internal state
      this._bypassGain.gain.linearRampToValueAtTime(1, now + rampTime);
      this._outputGain.gain.linearRampToValueAtTime(0, now + rampTime);
    } else {
      // Bypass off
      this._bypassGain.gain.linearRampToValueAtTime(0, now + rampTime);
      this._outputGain.gain.linearRampToValueAtTime(1, now + rampTime);
    }
  }

  reset() {
    // Mimeophon doesn't have a reset mechanism via message
    // Could potentially set hold to briefly capture then release
  }

  dispose() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this._inputGain.disconnect();
    this._outputGain.disconnect();
    this._bypassGain.disconnect();
    this.isInitialized = false;
  }

  get isExternal() {
    return true;
  }

  getPreset() {
    return {
      type: this.type,
      params: { ...this.params },
      bypassed: this.isBypassed
    };
  }

  loadPreset(preset) {
    if (preset.params) {
      for (const [name, value] of Object.entries(preset.params)) {
        this.setParam(name, value);
      }
    }
    if (preset.bypassed !== undefined) {
      this.bypass(preset.bypassed);
    }
  }

  /**
   * Get processor code as blob URL
   * This is the complete Mimeophon DSP implementation
   */
  _getProcessorURL() {
    const processorCode = `
// Mimeophon-Inspired Stereo Delay Processor
class MimeophonProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'zone', defaultValue: 1, minValue: 0, maxValue: 3 },
            { name: 'rate', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            { name: 'microRate', defaultValue: 0, minValue: 0, maxValue: 1 },
            { name: 'microRateFreq', defaultValue: 2, minValue: 0.1, maxValue: 8 },
            { name: 'skew', defaultValue: 0, minValue: -1, maxValue: 1 },
            { name: 'repeats', defaultValue: 0.3, minValue: 0, maxValue: 1.2 },
            { name: 'color', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            { name: 'halo', defaultValue: 0, minValue: 0, maxValue: 1 },
            { name: 'mix', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            { name: 'hold', defaultValue: 0, minValue: 0, maxValue: 1 },
            { name: 'flip', defaultValue: 0, minValue: 0, maxValue: 1 },
            { name: 'pingPong', defaultValue: 0, minValue: 0, maxValue: 1 },
            { name: 'swap', defaultValue: 0, minValue: 0, maxValue: 1 }
        ];
    }

    constructor(options) {
        super();

        this.sampleRate = options.processorOptions?.sampleRate || 48000;

        const maxDelaySamples = Math.ceil(this.sampleRate * 10);
        this.bufferL = new Float32Array(maxDelaySamples);
        this.bufferR = new Float32Array(maxDelaySamples);
        this.writeIndex = 0;
        this.bufferSize = maxDelaySamples;

        this.zones = [
            { min: 0.005, max: 0.050 },
            { min: 0.050, max: 0.400 },
            { min: 0.400, max: 2.000 },
            { min: 2.000, max: 10.000 }
        ];

        this.delayTimeL = 0.1;
        this.delayTimeR = 0.1;
        this.targetDelayTimeL = 0.1;
        this.targetDelayTimeR = 0.1;
        this.lfoPhase = 0;

        this.filterStateL = this.createFilterState();
        this.filterStateR = this.createFilterState();
        this.haloStateL = this.createHaloState();
        this.haloStateR = this.createHaloState();

        this.feedbackL = 0;
        this.feedbackR = 0;
        this.holdActive = false;
        this.holdBufferL = new Float32Array(maxDelaySamples);
        this.holdBufferR = new Float32Array(maxDelaySamples);
        this.flipActive = false;
    }

    createFilterState() {
        return {
            b1: { x1: 0, x2: 0, y1: 0, y2: 0 },
            b2: { x1: 0, x2: 0, y1: 0, y2: 0 },
            coefs1: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 },
            coefs2: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
        };
    }

    createHaloState() {
        return {
            buffers: [
                new Float32Array(1307),
                new Float32Array(1811),
                new Float32Array(2473),
                new Float32Array(3181)
            ],
            indices: [0, 0, 0, 0],
            g: [0.6, 0.55, 0.5, 0.45]
        };
    }

    getDelayTime(zone, rate) {
        const z = Math.floor(zone);
        const zoneData = this.zones[Math.min(z, 3)];
        return zoneData.min + rate * (zoneData.max - zoneData.min);
    }

    readBuffer(buffer, delaySamples) {
        const size = this.bufferSize;
        const readPos = (this.writeIndex - delaySamples + size) % size;
        const readIndex = Math.floor(readPos);
        const frac = readPos - readIndex;
        const idx1 = readIndex % size;
        const idx2 = (readIndex + 1) % size;
        return buffer[idx1] * (1 - frac) + buffer[idx2] * frac;
    }

    readBufferReverse(buffer, delaySamples) {
        const size = this.bufferSize;
        const readPos = (this.writeIndex + delaySamples) % size;
        const readIndex = Math.floor(readPos);
        const frac = readPos - readIndex;
        const idx1 = readIndex % size;
        const idx2 = (readIndex + 1) % size;
        return buffer[idx1] * (1 - frac) + buffer[idx2] * frac;
    }

    softSaturate(x) {
        if (x > 1) return 1 - Math.exp(-(x - 1));
        if (x < -1) return -1 + Math.exp(x + 1);
        return x;
    }

    asymmetricSaturate(x, bias = 0.3) {
        const shifted = x + bias;
        return Math.tanh(shifted * 1.5) - Math.tanh(bias * 1.5);
    }

    updateColorFilter(color, filterState) {
        if (color < 0.2) {
            const freq = 4000 + color * 5 * 7000;
            this.setLowpass(filterState.coefs1, freq, 0.707);
            this.setLowpass(filterState.coefs2, freq * 0.5, 0.707);
        } else if (color < 0.4) {
            const t = (color - 0.2) / 0.2;
            const freq = 4000 + t * 6000;
            this.setLowpass(filterState.coefs1, freq, 1.5);
            this.setBandpass(filterState.coefs2, 2000, 2);
        } else if (color < 0.6) {
            const t = (color - 0.4) / 0.2;
            const freq = 8000 - t * 2000;
            this.setHighShelf(filterState.coefs1, freq, -3, 0.707);
            this.setLowpass(filterState.coefs2, 12000, 0.707);
        } else if (color < 0.8) {
            const t = (color - 0.6) / 0.2;
            this.setHighShelf(filterState.coefs1, 8000, t * 2, 0.707);
            this.setAllpass(filterState.coefs2, 0);
        } else {
            const t = (color - 0.8) / 0.2;
            this.setHighShelf(filterState.coefs1, 6000, 3 + t * 2, 0.707);
            this.setPeaking(filterState.coefs2, 3000, 2, 1.5);
        }
    }

    setLowpass(coefs, freq, Q) {
        const w0 = 2 * Math.PI * freq / this.sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * Q);
        const b0 = (1 - cosw0) / 2;
        const b1 = 1 - cosw0;
        const b2 = (1 - cosw0) / 2;
        const a0 = 1 + alpha;
        const a1 = -2 * cosw0;
        const a2 = 1 - alpha;
        coefs.b0 = b0 / a0;
        coefs.b1 = b1 / a0;
        coefs.b2 = b2 / a0;
        coefs.a1 = a1 / a0;
        coefs.a2 = a2 / a0;
    }

    setHighShelf(coefs, freq, gainDB, Q) {
        const A = Math.pow(10, gainDB / 40);
        const w0 = 2 * Math.PI * freq / this.sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * Q);
        const b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha);
        const b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
        const b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha);
        const a0 = (A + 1) - (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha;
        const a1 = 2 * ((A - 1) - (A + 1) * cosw0);
        const a2 = (A + 1) - (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha;
        coefs.b0 = b0 / a0;
        coefs.b1 = b1 / a0;
        coefs.b2 = b2 / a0;
        coefs.a1 = a1 / a0;
        coefs.a2 = a2 / a0;
    }

    setBandpass(coefs, freq, Q) {
        const w0 = 2 * Math.PI * freq / this.sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * Q);
        const b0 = alpha;
        const b1 = 0;
        const b2 = -alpha;
        const a0 = 1 + alpha;
        const a1 = -2 * cosw0;
        const a2 = 1 - alpha;
        coefs.b0 = b0 / a0;
        coefs.b1 = b1 / a0;
        coefs.b2 = b2 / a0;
        coefs.a1 = a1 / a0;
        coefs.a2 = a2 / a0;
    }

    setPeaking(coefs, freq, gainDB, Q) {
        const A = Math.pow(10, gainDB / 40);
        const w0 = 2 * Math.PI * freq / this.sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * Q);
        const b0 = 1 + alpha * A;
        const b1 = -2 * cosw0;
        const b2 = 1 - alpha * A;
        const a0 = 1 + alpha / A;
        const a1 = -2 * cosw0;
        const a2 = 1 - alpha / A;
        coefs.b0 = b0 / a0;
        coefs.b1 = b1 / a0;
        coefs.b2 = b2 / a0;
        coefs.a1 = a1 / a0;
        coefs.a2 = a2 / a0;
    }

    setAllpass(coefs, freq) {
        if (freq === 0) {
            coefs.b0 = 1; coefs.b1 = 0; coefs.b2 = 0;
            coefs.a1 = 0; coefs.a2 = 0;
        } else {
            const w0 = 2 * Math.PI * freq / this.sampleRate;
            const cosw0 = Math.cos(w0);
            const sinw0 = Math.sin(w0);
            const alpha = sinw0 / 2;
            const b0 = 1 - alpha;
            const b1 = -2 * cosw0;
            const b2 = 1 + alpha;
            const a0 = 1 + alpha;
            const a1 = -2 * cosw0;
            const a2 = 1 - alpha;
            coefs.b0 = b0 / a0;
            coefs.b1 = b1 / a0;
            coefs.b2 = b2 / a0;
            coefs.a1 = a1 / a0;
            coefs.a2 = a2 / a0;
        }
    }

    processBiquad(input, state, coefs) {
        const output = coefs.b0 * input +
                      coefs.b1 * state.x1 +
                      coefs.b2 * state.x2 -
                      coefs.a1 * state.y1 -
                      coefs.a2 * state.y2;
        state.x2 = state.x1;
        state.x1 = input;
        state.y2 = state.y1;
        state.y1 = output;
        return output;
    }

    processHalo(input, haloState, amount) {
        if (amount < 0.001) return input;
        let signal = input;
        for (let i = 0; i < 4; i++) {
            const buffer = haloState.buffers[i];
            const index = haloState.indices[i];
            const g = haloState.g[i] * amount;
            const delayed = buffer[index];
            const output = -g * signal + delayed;
            buffer[index] = signal + g * output;
            haloState.indices[i] = (index + 1) % buffer.length;
            signal = output;
        }
        const wetMix = 0.5 + amount * 0.4;
        const dryMix = 1.0 - wetMix;
        return signal * wetMix + input * dryMix;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !output || !input[0]) {
            return true;
        }

        const inputL = input[0];
        const inputR = input[1] || input[0];
        const outputL = output[0];
        const outputR = output[1] || output[0];
        const blockSize = outputL.length;

        const getParam = (param, index) => {
            return param.length > 1 ? param[index] : param[0];
        };

        for (let i = 0; i < blockSize; i++) {
            const zone = getParam(parameters.zone, i);
            const rate = getParam(parameters.rate, i);
            const microRate = getParam(parameters.microRate, i);
            const microRateFreq = getParam(parameters.microRateFreq, i);
            const skew = getParam(parameters.skew, i);
            const repeats = getParam(parameters.repeats, i);
            const color = getParam(parameters.color, i);
            const halo = getParam(parameters.halo, i);
            const mix = getParam(parameters.mix, i);
            const hold = getParam(parameters.hold, i);
            const flip = getParam(parameters.flip, i);
            const pingPong = getParam(parameters.pingPong, i);
            const swap = getParam(parameters.swap, i);

            const holdNow = hold > 0.5;
            if (holdNow && !this.holdActive) {
                this.holdBufferL.set(this.bufferL);
                this.holdBufferR.set(this.bufferR);
                this.holdActive = true;
            } else if (!holdNow && this.holdActive) {
                this.holdActive = false;
            }

            this.flipActive = flip > 0.5;

            const baseDelayTime = this.getDelayTime(zone, rate);

            this.lfoPhase += 2 * Math.PI * microRateFreq / this.sampleRate;
            if (this.lfoPhase > 2 * Math.PI) this.lfoPhase -= 2 * Math.PI;
            const lfoValue = Math.sin(this.lfoPhase);
            const microRateOffset = lfoValue * microRate * 0.015;

            const skewAmount = skew * baseDelayTime * 0.5;
            this.targetDelayTimeL = baseDelayTime - skewAmount + microRateOffset;
            this.targetDelayTimeR = baseDelayTime + skewAmount + microRateOffset;

            if (swap > 0.5) {
                [this.targetDelayTimeL, this.targetDelayTimeR] =
                    [this.targetDelayTimeR, this.targetDelayTimeL];
            }

            const smoothingCoef = 0.999;
            this.delayTimeL = this.delayTimeL * smoothingCoef +
                             this.targetDelayTimeL * (1 - smoothingCoef);
            this.delayTimeR = this.delayTimeR * smoothingCoef +
                             this.targetDelayTimeR * (1 - smoothingCoef);

            const delayL = Math.max(0.001, this.delayTimeL) * this.sampleRate;
            const delayR = Math.max(0.001, this.delayTimeR) * this.sampleRate;

            let delayedL, delayedR;

            if (this.holdActive) {
                if (this.flipActive) {
                    delayedL = this.readBufferReverse(this.holdBufferL, delayL);
                    delayedR = this.readBufferReverse(this.holdBufferR, delayR);
                } else {
                    delayedL = this.readBuffer(this.holdBufferL, delayL);
                    delayedR = this.readBuffer(this.holdBufferR, delayR);
                }
            } else {
                if (this.flipActive) {
                    delayedL = this.readBufferReverse(this.bufferL, delayL);
                    delayedR = this.readBufferReverse(this.bufferR, delayR);
                } else {
                    delayedL = this.readBuffer(this.bufferL, delayL);
                    delayedR = this.readBuffer(this.bufferR, delayR);
                }
            }

            if (pingPong > 0.5) {
                const temp = delayedL;
                delayedL = this.feedbackR;
                delayedR = this.feedbackL;
            }

            this.updateColorFilter(color, this.filterStateL);
            this.updateColorFilter(color, this.filterStateR);

            let coloredL = this.processBiquad(delayedL, this.filterStateL.b1,
                                             this.filterStateL.coefs1);
            coloredL = this.processBiquad(coloredL, this.filterStateL.b2,
                                         this.filterStateL.coefs2);

            let coloredR = this.processBiquad(delayedR, this.filterStateR.b1,
                                             this.filterStateR.coefs1);
            coloredR = this.processBiquad(coloredR, this.filterStateR.b2,
                                         this.filterStateR.coefs2);

            const haloedL = this.processHalo(coloredL, this.haloStateL, halo);
            const haloedR = this.processHalo(coloredR, this.haloStateR, halo);

            let saturatedL, saturatedR;
            if (color < 0.6) {
                saturatedL = this.asymmetricSaturate(haloedL * 1.5, 0.2);
                saturatedR = this.asymmetricSaturate(haloedR * 1.5, 0.2);
            } else {
                saturatedL = this.softSaturate(haloedL * 1.2);
                saturatedR = this.softSaturate(haloedR * 1.2);
            }

            const feedbackAmount = Math.min(1.1, repeats);
            this.feedbackL = saturatedL * feedbackAmount;
            this.feedbackR = saturatedR * feedbackAmount;

            if (!this.holdActive) {
                this.bufferL[this.writeIndex] = inputL[i] + this.feedbackL * 0.9;
                this.bufferR[this.writeIndex] = inputR[i] + this.feedbackR * 0.9;
                this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
            }

            outputL[i] = inputL[i] * (1 - mix) + saturatedL * mix;
            outputR[i] = inputR[i] * (1 - mix) + saturatedR * mix;
        }

        return true;
    }
}

registerProcessor('mimeophon-processor', MimeophonProcessor);
`;

    const blob = new Blob([processorCode], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
  }
}

// Register with the effect wrapper system
registerExternalEffect('mimeophon', MimeophonAdapter);

export default MimeophonAdapter;
