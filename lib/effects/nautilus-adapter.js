// ============================================================================
// NAUTILUS ADAPTER
// Adapts the Nautilus multi-tap delay effect for use in the pedalboard system
// ============================================================================

import { ExternalEffectWrapper, registerExternalEffect } from '../effect-wrapper.js';

/**
 * Nautilus-inspired multi-tap delay effect adapter
 * Features 8 delay lines, multiple feedback modes, chroma effects, shimmer
 */
export class NautilusAdapter extends ExternalEffectWrapper {
  static get id() { return 'nautilus'; }
  static get name() { return 'Nautilus'; }
  static get category() { return 'Advanced'; }

  static get params() {
    return {
      mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' },
      resolution: { min: 0, max: 1, default: 0.4, step: 0.01, label: 'Resolution' },
      feedback: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Feedback' },
      sensors: { min: 1, max: 8, default: 1, step: 1, label: 'Sensors' },
      dispersal: { min: 0, max: 1, default: 0, step: 0.01, label: 'Dispersal' },
      reversal: { min: 0, max: 1, default: 0, step: 0.01, label: 'Reversal' },
      chroma: {
        min: 0, max: 5, default: 0, step: 1, label: 'Chroma',
        options: ['Oceanic', 'White Water', 'Refraction', 'Pulse Amp', 'Receptor', 'SOS']
      },
      depth: { min: 0, max: 1, default: 0, step: 0.01, label: 'Depth' },
      reverbMix: { min: 0, max: 1, default: 0, step: 0.01, label: 'Reverb' },
      delayMode: {
        min: 0, max: 3, default: 0, step: 1, label: 'Delay Mode',
        options: ['Fade', 'Doppler', 'Shimmer', 'De-Shimmer']
      },
      feedbackMode: {
        min: 0, max: 3, default: 0, step: 1, label: 'FB Mode',
        options: ['Normal', 'Ping Pong', 'Cascade', 'Adrift']
      }
    };
  }

  constructor(audioContext, slot = 0) {
    super('nautilus', audioContext, slot);
    this.workletNode = null;
    this.delayModes = ['fade', 'doppler', 'shimmer', 'deshimmer'];
    this.feedbackModes = ['normal', 'pingPong', 'cascade', 'adrift'];
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
      this.workletNode = new AudioWorkletNode(this.ctx, 'nautilus-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          sampleRate: this.ctx.sampleRate,
          maxDelayTime: 10
        }
      });

      // Initialize param values from defaults
      const paramDefs = NautilusAdapter.params;
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

      // Send initial parameters
      this._syncAllParams();

      this.isInitialized = true;
      return this;

    } catch (error) {
      console.error('NautilusAdapter: Failed to initialize:', error);
      throw error;
    }
  }

  _syncAllParams() {
    for (const [name, value] of Object.entries(this.params)) {
      this._sendParam(name, value);
    }
  }

  _sendParam(name, value) {
    if (!this.workletNode) return;

    // Handle mode parameters specially
    if (name === 'delayMode') {
      const mode = this.delayModes[Math.round(value)] || 'fade';
      this.workletNode.port.postMessage({ type: 'setDelayMode', mode });
    } else if (name === 'feedbackMode') {
      const mode = this.feedbackModes[Math.round(value)] || 'normal';
      this.workletNode.port.postMessage({ type: 'setFeedbackMode', mode });
    } else {
      this.workletNode.port.postMessage({
        type: 'setParam',
        name,
        value,
        smoothTime: 0.02
      });
    }
  }

  setParam(name, value) {
    this.params[name] = value;
    this._sendParam(name, value);

    if (this.onParamChange) {
      this.onParamChange(name, value);
    }
  }

  bypass(state) {
    this.isBypassed = state;
    const now = this.ctx.currentTime;
    const rampTime = 0.02;

    if (state) {
      this._bypassGain.gain.linearRampToValueAtTime(1, now + rampTime);
      this._outputGain.gain.linearRampToValueAtTime(0, now + rampTime);
    } else {
      this._bypassGain.gain.linearRampToValueAtTime(0, now + rampTime);
      this._outputGain.gain.linearRampToValueAtTime(1, now + rampTime);
    }
  }

  reset() {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'purge' });
    }
  }

  dispose() {
    if (this.workletNode) {
      this.workletNode.port.close();
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
   */
  _getProcessorURL() {
    const processorCode = `
// NAUTILUS PROCESSOR - AudioWorkletProcessor
// Multi-tap delay with 8 delay lines, chroma effects, shimmer

const MAX_DELAY_SAMPLES = 480000;
const GRAIN_SIZE = 2400;
const GRAIN_HOP = 600;
const MAX_GRAINS = 8;

class NautilusProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.sampleRate = options.processorOptions?.sampleRate || 48000;

        // Delay lines (8 total: 4L + 4R)
        this.delayLines = [];
        for (let i = 0; i < 8; i++) {
            this.delayLines.push({
                buffer: new Float32Array(MAX_DELAY_SAMPLES),
                writeIndex: 0,
                delayTime: this.sampleRate * 0.5,
                targetDelayTime: this.sampleRate * 0.5,
                reversed: false,
                crossfading: false,
                crossfadeProgress: 0,
                crossfadeSamples: 0,
                oldDelayTime: 0
            });
        }

        // Smoothed parameters
        this.params = {
            mix: { current: 0.5, target: 0.5 },
            feedback: { current: 0.5, target: 0.5 },
            dispersal: { current: 0, target: 0 },
            depth: { current: 0, target: 0 },
            reverbMix: { current: 0, target: 0 }
        };
        this.smoothingRate = 0.001;

        // Discrete parameters
        this.resolution = 0.4;
        this.sensors = 1;
        this.reversal = 0;
        this.chroma = 0;
        this.shimmerSemitones = 12;
        this.deshimmerSemitones = 12;
        this.reverbPreset = 0;

        // Modes
        this.delayMode = 'fade';
        this.feedbackMode = 'normal';

        // Clock
        this.bpm = 120;

        // Freeze
        this.freezeActive = false;
        this.freezeBuffer = null;
        this.freezeLength = 0;
        this.freezePlayhead = 0;

        // Chroma states
        this.chromaStates = [];
        for (let i = 0; i < 8; i++) {
            this.chromaStates.push(this._createChromaState());
        }

        // Pitch shifters
        this.pitchShifters = [
            this._createPitchShifter(12),
            this._createPitchShifter(-12)
        ];

        // Reverb
        this.reverb = this._createReverb();

        this.port.onmessage = (e) => this._handleMessage(e.data);
        this._updateDelayTimes();
    }

    _createChromaState() {
        return {
            lpf: [{ x1: 0, x2: 0, y1: 0, y2: 0 }, { x1: 0, x2: 0, y1: 0, y2: 0 }],
            hpf: [{ x1: 0, x2: 0, y1: 0, y2: 0 }, { x1: 0, x2: 0, y1: 0, y2: 0 }],
            crusherHold: 0,
            crusherCounter: 0
        };
    }

    _createPitchShifter(semitones) {
        const ratio = Math.pow(2, semitones / 12);
        const window = new Float32Array(GRAIN_SIZE);
        for (let i = 0; i < GRAIN_SIZE; i++) {
            window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (GRAIN_SIZE - 1)));
        }
        return {
            semitones, ratio, window,
            inputBuffer: new Float32Array(GRAIN_SIZE * 4),
            writeIndex: 0, grains: [], grainCounter: 0
        };
    }

    _createReverb() {
        const scale = this.sampleRate / 44100;
        const combDelays = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map(d => Math.floor(d * scale));
        const allpassDelays = [225, 556, 441, 341].map(d => Math.floor(d * scale));
        return {
            combs: combDelays.map(d => ({ buffer: new Float32Array(d), index: 0, feedback: 0.84 })),
            allpasses: allpassDelays.map(d => ({ buffer: new Float32Array(d), index: 0 })),
            lowpassState: 0, dampening: 0.3
        };
    }

    _handleMessage(data) {
        switch (data.type) {
            case 'setParam': this._setParam(data.name, data.value); break;
            case 'setDelayMode': this.delayMode = data.mode; break;
            case 'setFeedbackMode': this.feedbackMode = data.mode; break;
            case 'setBPM': this.bpm = data.bpm; this._updateDelayTimes(); break;
            case 'freeze':
                if (data.active) this._activateFreeze();
                else this.freezeActive = false;
                break;
            case 'purge': this._purge(); break;
        }
    }

    _setParam(name, value) {
        switch (name) {
            case 'mix': case 'feedback': case 'dispersal': case 'depth': case 'reverbMix':
                this.params[name].target = value; break;
            case 'resolution': this.resolution = value; this._updateDelayTimes(); break;
            case 'sensors': this.sensors = Math.max(1, Math.min(8, Math.round(value))); break;
            case 'reversal': this.reversal = value; this._updateReversals(); break;
            case 'chroma': this.chroma = Math.round(value); break;
            case 'shimmerSemitones':
                this.shimmerSemitones = Math.round(value);
                this.pitchShifters[0].ratio = Math.pow(2, this.shimmerSemitones / 12);
                break;
            case 'deshimmerSemitones':
                this.deshimmerSemitones = Math.round(value);
                this.pitchShifters[1].ratio = Math.pow(2, -this.deshimmerSemitones / 12);
                break;
        }
    }

    _updateDelayTimes() {
        const beatDuration = 60.0 / this.bpm;
        const resolutionMult = this._getResolutionMultiplier(this.resolution);
        const baseDelaySec = beatDuration * resolutionMult;

        for (let i = 0; i < 8; i++) {
            const line = this.delayLines[i];
            const lineIndex = i % 4;
            const dispersalOffset = lineIndex * this.params.dispersal.target * baseDelaySec * 0.5;
            const totalDelaySec = Math.min(10, Math.max(0.001, baseDelaySec + dispersalOffset));
            const newDelayTime = Math.floor(totalDelaySec * this.sampleRate);

            if (this.delayMode === 'fade' && Math.abs(newDelayTime - line.delayTime) > 100) {
                line.crossfading = true;
                line.crossfadeProgress = 0;
                line.crossfadeSamples = Math.floor(0.05 * this.sampleRate);
                line.oldDelayTime = line.delayTime;
            }
            line.targetDelayTime = newDelayTime;
        }
    }

    _getResolutionMultiplier(resolution) {
        const divisions = [8, 4, 3, 2, 1.5, 1, 0.75, 0.5, 0.333, 0.25, 0.167, 0.125, 0.0625, 0.03125, 0.015625, 0.0078125];
        return divisions[Math.floor(resolution * (divisions.length - 1))];
    }

    _updateReversals() {
        const totalReversed = Math.floor(this.reversal * 8);
        const order = [0, 4, 1, 5, 2, 6, 3, 7];
        for (let i = 0; i < 8; i++) {
            this.delayLines[order[i]].reversed = i < totalReversed;
        }
    }

    _activateFreeze() {
        const baseDelay = this.delayLines[0].delayTime;
        this.freezeLength = Math.min(baseDelay, MAX_DELAY_SAMPLES / 2);
        this.freezeBuffer = new Float32Array(this.freezeLength * 2);
        const lineL = this.delayLines[0], lineR = this.delayLines[4];
        for (let i = 0; i < this.freezeLength; i++) {
            const idx = (lineL.writeIndex - this.freezeLength + i + MAX_DELAY_SAMPLES) % MAX_DELAY_SAMPLES;
            this.freezeBuffer[i * 2] = lineL.buffer[idx];
            this.freezeBuffer[i * 2 + 1] = lineR.buffer[idx];
        }
        this.freezePlayhead = 0;
        this.freezeActive = true;
    }

    _purge() {
        for (const line of this.delayLines) line.buffer.fill(0);
        this.freezeActive = false;
    }

    _smoothParam(param) {
        param.current += (param.target - param.current) * this.smoothingRate;
    }

    _readDelayLine(line, delaySamples) {
        const readPos = (line.writeIndex - delaySamples + MAX_DELAY_SAMPLES) % MAX_DELAY_SAMPLES;
        const floor = Math.floor(readPos), frac = readPos - floor;
        return line.buffer[floor] * (1 - frac) + line.buffer[(floor + 1) % MAX_DELAY_SAMPLES] * frac;
    }

    _readDelayLineReversed(line, delaySamples) {
        const readPos = (line.writeIndex + (delaySamples % line.delayTime)) % MAX_DELAY_SAMPLES;
        const floor = Math.floor(readPos), frac = readPos - floor;
        return line.buffer[floor] * (1 - frac) + line.buffer[(floor + 1) % MAX_DELAY_SAMPLES] * frac;
    }

    _readWithFade(line) {
        if (!line.crossfading) {
            return line.reversed ? this._readDelayLineReversed(line, line.delayTime) : this._readDelayLine(line, line.delayTime);
        }
        const t = line.crossfadeProgress / line.crossfadeSamples;
        const fadeOut = Math.cos(t * Math.PI * 0.5), fadeIn = Math.sin(t * Math.PI * 0.5);
        const oldSample = this._readDelayLine(line, line.oldDelayTime);
        const newSample = this._readDelayLine(line, line.targetDelayTime);
        line.crossfadeProgress++;
        if (line.crossfadeProgress >= line.crossfadeSamples) {
            line.crossfading = false;
            line.delayTime = line.targetDelayTime;
        }
        return oldSample * fadeOut + newSample * fadeIn;
    }

    _readWithDoppler(line) {
        line.delayTime += (line.targetDelayTime - line.delayTime) * 0.0001;
        return line.reversed ? this._readDelayLineReversed(line, line.delayTime) : this._readDelayLine(line, line.delayTime);
    }

    _processPitchShifter(shifter, sample) {
        shifter.inputBuffer[shifter.writeIndex] = sample;
        shifter.writeIndex = (shifter.writeIndex + 1) % shifter.inputBuffer.length;
        shifter.grainCounter++;
        if (shifter.grainCounter >= GRAIN_HOP && shifter.grains.length < MAX_GRAINS) {
            shifter.grainCounter = 0;
            shifter.grains.push({
                startIndex: (shifter.writeIndex - GRAIN_SIZE + shifter.inputBuffer.length) % shifter.inputBuffer.length,
                position: 0
            });
        }
        let output = 0;
        for (let i = shifter.grains.length - 1; i >= 0; i--) {
            const grain = shifter.grains[i];
            const readPos = grain.startIndex + (grain.position * shifter.ratio);
            const wrappedPos = ((readPos % shifter.inputBuffer.length) + shifter.inputBuffer.length) % shifter.inputBuffer.length;
            const floor = Math.floor(wrappedPos), frac = wrappedPos - floor;
            const grainSample = shifter.inputBuffer[floor] * (1 - frac) + shifter.inputBuffer[(floor + 1) % shifter.inputBuffer.length] * frac;
            output += grainSample * shifter.window[grain.position];
            grain.position++;
            if (grain.position >= GRAIN_SIZE) shifter.grains.splice(i, 1);
        }
        return output;
    }

    _processChroma(sample, state, depth) {
        if (depth < 0.001) return sample;
        switch (this.chroma) {
            case 0: return this._processLowpass(sample, state, depth);
            case 1: return this._processHighpass(sample, state, depth);
            case 2: return this._processBitcrusher(sample, state, depth);
            case 3: return this._processSaturation(sample, depth);
            case 4: return this._processWavefolder(sample, depth);
            case 5: return this._processDistortion(sample, depth);
            default: return sample;
        }
    }

    _processLowpass(sample, state, depth) {
        const cutoff = 20000 * Math.pow(0.01, depth);
        const omega = 2 * Math.PI * cutoff / this.sampleRate;
        const sin = Math.sin(omega), cos = Math.cos(omega), alpha = sin / (2 * Math.SQRT2);
        const a0 = 1 + alpha;
        const coeffs = { b0: ((1 - cos) / 2) / a0, b1: (1 - cos) / a0, b2: ((1 - cos) / 2) / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
        let x = sample;
        for (const s of state.lpf) {
            const y = coeffs.b0 * x + coeffs.b1 * s.x1 + coeffs.b2 * s.x2 - coeffs.a1 * s.y1 - coeffs.a2 * s.y2;
            s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y; x = y;
        }
        return x;
    }

    _processHighpass(sample, state, depth) {
        const cutoff = 20 + depth * 1980;
        const omega = 2 * Math.PI * cutoff / this.sampleRate;
        const sin = Math.sin(omega), cos = Math.cos(omega), alpha = sin / (2 * Math.SQRT2);
        const a0 = 1 + alpha;
        const coeffs = { b0: ((1 + cos) / 2) / a0, b1: -(1 + cos) / a0, b2: ((1 + cos) / 2) / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
        let x = sample;
        for (const s of state.hpf) {
            const y = coeffs.b0 * x + coeffs.b1 * s.x1 + coeffs.b2 * s.x2 - coeffs.a1 * s.y1 - coeffs.a2 * s.y2;
            s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y; x = y;
        }
        return x;
    }

    _processBitcrusher(sample, state, depth) {
        const bits = Math.max(2, 16 - depth * 14), srReduction = Math.max(1, Math.floor(depth * 32));
        state.crusherCounter++;
        if (state.crusherCounter >= srReduction) { state.crusherCounter = 0; state.crusherHold = sample; }
        const levels = Math.pow(2, bits);
        return Math.round(state.crusherHold * levels) / levels;
    }

    _processSaturation(sample, depth) {
        const x = sample * (1 + depth * 4);
        return x > 0 ? Math.tanh(x * 1.5) / 1.5 : Math.tanh(x) / 1.2;
    }

    _processWavefolder(sample, depth) {
        return Math.sin(sample * (1 + depth * 5) * Math.PI) * 0.8;
    }

    _processDistortion(sample, depth) {
        const x = sample * (1 + depth * 20);
        return Math.tanh(Math.max(-1, Math.min(1, x)) * 3) * 0.7;
    }

    _applyFeedbackRouting(delayOutputs, fb) {
        fb = Math.min(0.99, fb);
        switch (this.feedbackMode) {
            case 'pingPong':
                return [delayOutputs[4]*fb, delayOutputs[5]*fb, delayOutputs[6]*fb, delayOutputs[7]*fb,
                        delayOutputs[0]*fb, delayOutputs[1]*fb, delayOutputs[2]*fb, delayOutputs[3]*fb];
            case 'cascade':
                return [delayOutputs[3]*fb, delayOutputs[0]*fb, delayOutputs[1]*fb, delayOutputs[2]*fb,
                        delayOutputs[7]*fb, delayOutputs[4]*fb, delayOutputs[5]*fb, delayOutputs[6]*fb];
            case 'adrift':
                return [delayOutputs[7]*fb, delayOutputs[4]*fb, delayOutputs[5]*fb, delayOutputs[6]*fb,
                        delayOutputs[0]*fb, delayOutputs[1]*fb, delayOutputs[2]*fb, delayOutputs[3]*fb];
            default:
                return delayOutputs.map(out => out * fb);
        }
    }

    _processReverb(inputL, inputR, mix) {
        if (mix < 0.001) return [inputL, inputR];
        const input = (inputL + inputR) * 0.5;
        let combSum = 0;
        for (const comb of this.reverb.combs) {
            const delayed = comb.buffer[comb.index];
            const filtered = this.reverb.lowpassState * this.reverb.dampening + delayed * (1 - this.reverb.dampening);
            this.reverb.lowpassState = filtered;
            comb.buffer[comb.index] = input + filtered * comb.feedback * mix;
            comb.index = (comb.index + 1) % comb.buffer.length;
            combSum += delayed;
        }
        combSum /= this.reverb.combs.length;
        let apOut = combSum;
        for (const ap of this.reverb.allpasses) {
            const delayed = ap.buffer[ap.index];
            const output = -apOut + delayed;
            ap.buffer[ap.index] = apOut + delayed * 0.5;
            ap.index = (ap.index + 1) % ap.buffer.length;
            apOut = output;
        }
        return [inputL * (1 - mix) + apOut * mix, inputR * (1 - mix) + apOut * mix];
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0], output = outputs[0];
        if (!input || !input[0]) return true;
        const inputL = input[0], inputR = input[1] || input[0];
        const outputL = output[0], outputR = output[1] || output[0];

        for (let i = 0; i < inputL.length; i++) {
            this._smoothParam(this.params.mix);
            this._smoothParam(this.params.feedback);
            this._smoothParam(this.params.dispersal);
            this._smoothParam(this.params.depth);
            this._smoothParam(this.params.reverbMix);

            const inL = inputL[i], inR = inputR[i];
            const delayOutputs = new Array(8);

            for (let j = 0; j < 8; j++) {
                const line = this.delayLines[j];
                if ((j % 4) >= this.sensors) { delayOutputs[j] = 0; continue; }
                let sample;
                if (this.delayMode === 'fade') sample = this._readWithFade(line);
                else if (this.delayMode === 'doppler') sample = this._readWithDoppler(line);
                else sample = line.reversed ? this._readDelayLineReversed(line, line.delayTime) : this._readDelayLine(line, line.delayTime);
                delayOutputs[j] = sample;
            }

            let wetL = 0, wetR = 0;
            for (let j = 0; j < 4; j++) { wetL += delayOutputs[j] / this.sensors; wetR += delayOutputs[j + 4] / this.sensors; }

            if (this.freezeActive && this.freezeBuffer) {
                const idx = this.freezePlayhead * 2;
                wetL = this.freezeBuffer[idx]; wetR = this.freezeBuffer[idx + 1];
                this.freezePlayhead = (this.freezePlayhead + 1) % this.freezeLength;
            }

            [wetL, wetR] = this._processReverb(wetL, wetR, this.params.reverbMix.current);

            let feedbackSignals = this._applyFeedbackRouting(delayOutputs, this.params.feedback.current);
            for (let j = 0; j < 8; j++) {
                let fb = feedbackSignals[j];
                fb = this._processChroma(fb, this.chromaStates[j], this.params.depth.current);
                if (this.delayMode === 'shimmer') fb = this._processPitchShifter(this.pitchShifters[0], fb);
                else if (this.delayMode === 'deshimmer') fb = this._processPitchShifter(this.pitchShifters[1], fb);
                feedbackSignals[j] = fb;
            }

            for (let j = 0; j < 4; j++) {
                const lineL = this.delayLines[j], lineR = this.delayLines[j + 4];
                lineL.buffer[lineL.writeIndex] = inL + feedbackSignals[j];
                lineR.buffer[lineR.writeIndex] = inR + feedbackSignals[j + 4];
                lineL.writeIndex = (lineL.writeIndex + 1) % MAX_DELAY_SAMPLES;
                lineR.writeIndex = (lineR.writeIndex + 1) % MAX_DELAY_SAMPLES;
            }

            const mix = this.params.mix.current;
            outputL[i] = inL * (1 - mix) + wetL * mix;
            outputR[i] = inR * (1 - mix) + wetR * mix;
        }
        return true;
    }
}

registerProcessor('nautilus-processor', NautilusProcessor);
`;

    const blob = new Blob([processorCode], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
  }
}

// Register with the effect wrapper system
registerExternalEffect('nautilus', NautilusAdapter);

export default NautilusAdapter;
