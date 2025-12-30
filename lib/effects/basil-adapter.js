// ============================================================================
// BASIL ADAPTER
// Integrates Bastl Instruments Basil Stereo Space Delay into pedalboard system
// ============================================================================

import { ExternalEffectWrapper, registerExternalEffect } from '../effect-wrapper.js';

// Inline processor code for blob URL loading
const BASIL_PROCESSOR_CODE = `
const MAX_DELAY_SAMPLES = 192000;
const DIFFUSER_DELAYS = [149, 211, 307, 419];
const ALLPASS_DELAYS = [113, 173, 241, 337];

class BasilProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.sampleRate = options.processorOptions?.sampleRate || 48000;
        this.delayBufferL = new Float32Array(MAX_DELAY_SAMPLES);
        this.delayBufferR = new Float32Array(MAX_DELAY_SAMPLES);
        this.writeIndexL = 0;
        this.writeIndexR = 0;
        this.baseDelayTime = this.sampleRate * 0.25;
        this.targetDelayTime = this.sampleRate * 0.25;
        this.stereoSpread = 0;
        this.fineAdjust = 0;
        this.delayTimeL = this.baseDelayTime;
        this.delayTimeR = this.baseDelayTime;
        this.targetDelayTimeL = this.baseDelayTime;
        this.targetDelayTimeR = this.baseDelayTime;
        this.params = {
            mix: { current: 0.5, target: 0.5 },
            feedback: { current: 0.5, target: 0.5 },
            blur: { current: 0, target: 0 },
            filter: { current: 0, target: 0 },
            taps: { current: 0, target: 0 },
            inputGain: { current: 1, target: 1 }
        };
        this.smoothingRate = 0.0005;
        this.speedMode = 0;
        this.lofiMode = false;
        this.feedbackMode = 'normal';
        this.freezeActive = false;
        this.freezeBufferL = null;
        this.freezeBufferR = null;
        this.freezeLength = 0;
        this.freezePlayhead = 0;
        this.blurPreStates = this._createDiffuserStates();
        this.blurPostStates = this._createDiffuserStates();
        this.filterStateL = { x1: 0, x2: 0, y1: 0, y2: 0 };
        this.filterStateR = { x1: 0, x2: 0, y1: 0, y2: 0 };
        this.compressorStateL = { envelope: 0, gain: 1 };
        this.compressorStateR = { envelope: 0, gain: 1 };
        this.decimationCounter = 0;
        this.holdSampleL = 0;
        this.holdSampleR = 0;
        this.port.onmessage = (e) => this._handleMessage(e.data);
    }

    _createDiffuserStates() {
        return {
            allpasses: DIFFUSER_DELAYS.map(d => ({ buffer: new Float32Array(d), index: 0, feedback: 0.5 })),
            allpassesR: ALLPASS_DELAYS.map(d => ({ buffer: new Float32Array(d), index: 0, feedback: 0.5 }))
        };
    }

    _handleMessage(data) {
        switch (data.type) {
            case 'setParam': this._setParam(data.name, data.value); break;
            case 'setSpeedMode': this.speedMode = Math.max(0, Math.min(3, Math.round(data.mode))); this._updateDelayTimes(); break;
            case 'setLoFi': this.lofiMode = !!data.active; break;
            case 'freeze': if (data.active) this._activateFreeze(); else this.freezeActive = false; break;
            case 'purge': this._purge(); break;
        }
    }

    _setParam(name, value) {
        switch (name) {
            case 'time': this._setDelayTime(value); break;
            case 'stereo': this.stereoSpread = Math.max(0, Math.min(1, value)); this._updateDelayTimes(); break;
            case 'fine': this.fineAdjust = Math.max(-1, Math.min(1, value)); this._updateDelayTimes(); break;
            case 'mix': case 'blur': case 'filter': case 'taps': case 'inputGain':
                if (this.params[name]) this.params[name].target = value; break;
            case 'feedback':
                this.params.feedback.target = Math.max(-1, Math.min(1, value));
                this.feedbackMode = value < 0 ? 'pingPong' : 'normal';
                break;
        }
    }

    _setDelayTime(normalized) {
        const speedMult = [1, 2, 4, 8][this.speedMode];
        const maxDelaySeconds = 0.5 * speedMult, minDelaySeconds = 0.001;
        const delaySeconds = minDelaySeconds + (1 - normalized) * (maxDelaySeconds - minDelaySeconds);
        this.targetDelayTime = delaySeconds * this.sampleRate;
        this._updateDelayTimes();
    }

    _updateDelayTimes() {
        const spreadFactor = this.stereoSpread;
        const delayL = this.targetDelayTime * (1 + spreadFactor * 0.5);
        const delayR = this.targetDelayTime * (1 - spreadFactor * 0.5);
        const fineRange = this.targetDelayTime * 0.1, fineOffset = this.fineAdjust * fineRange;
        this.targetDelayTimeL = Math.max(1, Math.min(MAX_DELAY_SAMPLES - 1, delayL + fineOffset));
        this.targetDelayTimeR = Math.max(1, Math.min(MAX_DELAY_SAMPLES - 1, delayR + fineOffset));
    }

    _activateFreeze() {
        const freezeLen = Math.min(Math.floor(this.delayTimeL), MAX_DELAY_SAMPLES / 2);
        this.freezeLength = freezeLen;
        this.freezeBufferL = new Float32Array(freezeLen);
        this.freezeBufferR = new Float32Array(freezeLen);
        for (let i = 0; i < freezeLen; i++) {
            this.freezeBufferL[i] = this.delayBufferL[(this.writeIndexL - freezeLen + i + MAX_DELAY_SAMPLES) % MAX_DELAY_SAMPLES];
            this.freezeBufferR[i] = this.delayBufferR[(this.writeIndexR - freezeLen + i + MAX_DELAY_SAMPLES) % MAX_DELAY_SAMPLES];
        }
        this.freezePlayhead = 0;
        this.freezeActive = true;
    }

    _purge() { this.delayBufferL.fill(0); this.delayBufferR.fill(0); this.freezeActive = false; }
    _smoothParam(param) { param.current += (param.target - param.current) * this.smoothingRate; }

    _readDelay(buffer, writeIndex, delaySamples) {
        const readPos = (writeIndex - delaySamples + MAX_DELAY_SAMPLES) % MAX_DELAY_SAMPLES;
        const floor = Math.floor(readPos), frac = readPos - floor, next = (floor + 1) % MAX_DELAY_SAMPLES;
        return buffer[floor] * (1 - frac) + buffer[next] * frac;
    }

    _readTaps(buffer, writeIndex, baseDelay, tapsAmount) {
        if (Math.abs(tapsAmount) < 0.01) return 0;
        const absAmount = Math.abs(tapsAmount), useEvenOnly = tapsAmount > 0;
        let sum = 0, count = 0;
        const taps = useEvenOnly ? [0.5, 0.25, 0.167, 0.125] : [0.5, 0.333, 0.25, 0.2, 0.167, 0.143, 0.125];
        for (let i = 0; i < taps.length; i++) {
            if (absAmount > i * (useEvenOnly ? 0.25 : 0.143)) { sum += this._readDelay(buffer, writeIndex, baseDelay * taps[i]); count++; }
        }
        return count > 0 ? (sum / count) * absAmount : 0;
    }

    _processBlur(sampleL, sampleR, states, amount) {
        if (Math.abs(amount) < 0.01) return [sampleL, sampleR];
        const absAmount = Math.abs(amount);
        let outL = sampleL, outR = sampleR;
        for (let i = 0; i < states.allpasses.length; i++) {
            const apL = states.allpasses[i], apR = states.allpassesR[i];
            const delayedL = apL.buffer[apL.index], delayedR = apR.buffer[apR.index];
            const newL = -outL + delayedL, newR = -outR + delayedR;
            apL.buffer[apL.index] = outL + delayedL * apL.feedback;
            apR.buffer[apR.index] = outR + delayedR * apR.feedback;
            apL.index = (apL.index + 1) % apL.buffer.length;
            apR.index = (apR.index + 1) % apR.buffer.length;
            outL = newL; outR = newR;
        }
        return [sampleL * (1 - absAmount) + outL * absAmount, sampleR * (1 - absAmount) + outR * absAmount];
    }

    _processFilter(sample, state, filterAmount) {
        if (Math.abs(filterAmount) < 0.01) return sample;
        const absAmount = Math.abs(filterAmount), isLowpass = filterAmount < 0;
        const cutoff = isLowpass ? 20000 * Math.pow(0.01, absAmount) : 20 + absAmount * 1980;
        const omega = 2 * Math.PI * cutoff / this.sampleRate, sin = Math.sin(omega), cos = Math.cos(omega), alpha = sin / (2 * Math.SQRT2), a0 = 1 + alpha;
        const b0 = isLowpass ? ((1 - cos) / 2) / a0 : ((1 + cos) / 2) / a0;
        const b1 = isLowpass ? (1 - cos) / a0 : -(1 + cos) / a0;
        const b2 = b0, a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
        const y = b0 * sample + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
        state.x2 = state.x1; state.x1 = sample; state.y2 = state.y1; state.y1 = y;
        return y;
    }

    _processCompressor(sample, state) {
        const threshold = 0.8, ratio = 4, attackCoeff = 1 - Math.exp(-1 / (0.001 * this.sampleRate)), releaseCoeff = 1 - Math.exp(-1 / (0.1 * this.sampleRate));
        const absSample = Math.abs(sample);
        state.envelope += (absSample - state.envelope) * (absSample > state.envelope ? attackCoeff : releaseCoeff);
        state.gain = state.envelope > threshold ? (threshold + (state.envelope - threshold) / ratio) / state.envelope : 1;
        return Math.tanh(sample * state.gain * 1.2) / 1.2;
    }

    _constantPowerMix(dry, wet, mix) { return dry * Math.cos(mix * Math.PI * 0.5) + wet * Math.sin(mix * Math.PI * 0.5); }

    process(inputs, outputs, parameters) {
        const input = inputs[0], output = outputs[0];
        if (!input || !input[0]) return true;
        const inputL = input[0], inputR = input[1] || input[0], outputL = output[0], outputR = output[1] || output[0];
        const decimation = [1, 2, 4, 8][this.speedMode];

        for (let i = 0; i < inputL.length; i++) {
            Object.keys(this.params).forEach(k => this._smoothParam(this.params[k]));
            this.delayTimeL += (this.targetDelayTimeL - this.delayTimeL) * 0.0001;
            this.delayTimeR += (this.targetDelayTimeR - this.delayTimeR) * 0.0001;
            let inL = inputL[i] * this.params.inputGain.current, inR = inputR[i] * this.params.inputGain.current;
            this.decimationCounter++;
            if (this.decimationCounter >= decimation) { this.decimationCounter = 0; this.holdSampleL = inL; this.holdSampleR = inR; }
            if (decimation > 1) { inL = this.holdSampleL; inR = this.holdSampleR; }

            let wetL, wetR;
            if (this.freezeActive && this.freezeBufferL) {
                wetL = this.freezeBufferL[this.freezePlayhead]; wetR = this.freezeBufferR[this.freezePlayhead];
                this.freezePlayhead = (this.freezePlayhead + 1) % this.freezeLength;
            } else {
                wetL = this._readDelay(this.delayBufferL, this.writeIndexL, this.delayTimeL);
                wetR = this._readDelay(this.delayBufferR, this.writeIndexR, this.delayTimeR);
                wetL += this._readTaps(this.delayBufferL, this.writeIndexL, this.delayTimeL, this.params.taps.current);
                wetR += this._readTaps(this.delayBufferR, this.writeIndexR, this.delayTimeR, this.params.taps.current);
            }

            const blurAmount = this.params.blur.current;
            if (blurAmount < 0) [wetL, wetR] = this._processBlur(wetL, wetR, this.blurPreStates, -blurAmount);
            const filterAmount = this.params.filter.current;
            let filteredL = this._processFilter(wetL, this.filterStateL, filterAmount);
            let filteredR = this._processFilter(wetR, this.filterStateR, filterAmount);
            if (blurAmount > 0) [filteredL, filteredR] = this._processBlur(filteredL, filteredR, this.blurPostStates, blurAmount);

            const fbSafe = Math.min(0.98, Math.abs(this.params.feedback.current));
            let feedbackL, feedbackR;
            if (this.feedbackMode === 'pingPong') { feedbackL = filteredR * fbSafe; feedbackR = filteredL * fbSafe; }
            else { feedbackL = filteredL * fbSafe; feedbackR = filteredR * fbSafe; }
            feedbackL = this._processCompressor(feedbackL, this.compressorStateL);
            feedbackR = this._processCompressor(feedbackR, this.compressorStateR);

            if (!this.freezeActive) {
                this.delayBufferL[this.writeIndexL] = inL + feedbackL;
                this.delayBufferR[this.writeIndexR] = inR + feedbackR;
                this.writeIndexL = (this.writeIndexL + 1) % MAX_DELAY_SAMPLES;
                this.writeIndexR = (this.writeIndexR + 1) % MAX_DELAY_SAMPLES;
            }

            outputL[i] = this._constantPowerMix(inputL[i], wetL, this.params.mix.current);
            outputR[i] = this._constantPowerMix(inputR[i], wetR, this.params.mix.current);
        }
        return true;
    }
}
registerProcessor('basil-processor', BasilProcessor);
`;

export class BasilAdapter extends ExternalEffectWrapper {
  constructor(audioContext, slot) {
    super('basil', audioContext, slot);

    this.params = {
      mix: 0.5,
      time: 0.5,
      stereo: 0,
      feedback: 0.5,
      blur: 0,
      filter: 0,
      taps: 0,
      speedMode: 0,
      freeze: 0
    };
  }

  async initialize() {
    const blob = new Blob([BASIL_PROCESSOR_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      await this.ctx.audioWorklet.addModule(url);
    } catch (e) {
      if (!e.message.includes('already been added')) {
        console.warn('BasilAdapter: Worklet registration note:', e.message);
      }
    }

    URL.revokeObjectURL(url);

    this.workletNode = new AudioWorkletNode(this.ctx, 'basil-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { sampleRate: this.ctx.sampleRate }
    });

    this._inputGain = this.ctx.createGain();
    this._outputGain = this.ctx.createGain();
    this._bypassGain = this.ctx.createGain();
    this._bypassGain.gain.value = 0;

    this._inputGain.connect(this.workletNode);
    this.workletNode.connect(this._outputGain);
    this._inputGain.connect(this._bypassGain);
    this._bypassGain.connect(this._outputGain);

    this._bypassed = false;
    this._isLoaded = true;

    return this;
  }

  get input() { return this._inputGain; }
  get output() { return this._outputGain; }

  setParam(name, value) {
    if (!(name in this.params)) {
      console.warn(`BasilAdapter: Unknown parameter "${name}"`);
      return;
    }
    this.params[name] = value;

    if (name === 'speedMode') {
      this.workletNode?.port.postMessage({ type: 'setSpeedMode', mode: Math.floor(value) });
      return;
    }
    if (name === 'freeze') {
      this.workletNode?.port.postMessage({ type: 'freeze', active: value > 0.5 });
      return;
    }

    this.workletNode?.port.postMessage({ type: 'setParam', name, value });
  }

  getParam(name) { return this.params[name]; }

  bypass(bypassed) {
    this._bypassed = bypassed;
    const now = this.ctx.currentTime;
    if (bypassed) {
      this._bypassGain.gain.setTargetAtTime(1, now, 0.01);
      this.workletNode?.port.postMessage({ type: 'setParam', name: 'mix', value: 0 });
    } else {
      this._bypassGain.gain.setTargetAtTime(0, now, 0.01);
      this.workletNode?.port.postMessage({ type: 'setParam', name: 'mix', value: this.params.mix });
    }
  }

  purge() { this.workletNode?.port.postMessage({ type: 'purge' }); }

  dispose() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.close();
      this.workletNode = null;
    }
    this._inputGain?.disconnect();
    this._outputGain?.disconnect();
    this._bypassGain?.disconnect();
    this._isLoaded = false;
  }
}

registerExternalEffect('basil', BasilAdapter);
