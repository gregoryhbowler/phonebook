// ============================================================================
// DATABENDER ADAPTER
// Integrates Qu-Bit Electronix Data Bender into pedalboard system
// ============================================================================

import { ExternalEffectWrapper, registerExternalEffect } from '../effect-wrapper.js';

// Inline processor code (minified for space)
const DATABENDER_PROCESSOR_CODE = `
const MAX_BUFFER_SAMPLES = 48000 * 65;
const CORRUPT_DECIMATE = 0;
const CORRUPT_DROPOUT = 1;
const CORRUPT_DESTROY = 2;
const CORRUPT_DJFILTER = 3;
const CORRUPT_VINYLSIM = 4;

class DataBenderProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.sampleRate = options.processorOptions?.sampleRate || 48000;
        this.bufferL = new Float32Array(MAX_BUFFER_SAMPLES);
        this.bufferR = new Float32Array(MAX_BUFFER_SAMPLES);
        this.writeHead = 0;
        this.playHead = 0;
        this.clockMode = 'internal';
        this.internalClockRate = 1;
        this.externalBPM = 120;
        this.clockDivMult = 1;
        this.bufferLength = this.sampleRate;
        this.targetBufferLength = this.sampleRate;
        this.repeats = 1;
        this.currentRepeat = 0;
        this.repeatPhase = 0;
        this.mode = 'macro';
        this.bendEnabled = false;
        this.bendAmount = 0;
        this.microBendPitch = 1;
        this.microBendReverse = false;
        this.currentPlaybackSpeed = 1;
        this.targetPlaybackSpeed = 1;
        this.isReversed = false;
        this.tapeStopActive = false;
        this.tapeStopProgress = 0;
        this.slewActive = false;
        this.breakEnabled = false;
        this.breakAmount = 0;
        this.breakMicroMode = 'traverse';
        this.traversePosition = 0;
        this.silenceAmount = 0;
        this.silencePhase = 0;
        this.corruptType = CORRUPT_DECIMATE;
        this.corruptAmount = 0;
        this.decimateCounter = 0;
        this.dropoutActive = false;
        this.dropoutLength = 0;
        this.dropoutCounter = 0;
        this.djFilterState = { x1: 0, x2: 0, y1: 0, y2: 0 };
        this.djFilterStateR = { x1: 0, x2: 0, y1: 0, y2: 0 };
        this.vinylClickTimer = 0;
        this.vinylWowPhase = 0;
        this.mix = 0.5;
        this.targetMix = 0.5;
        this.freezeActive = false;
        this.freezeLength = 0;
        this.stereoWidth = 0;
        this.windowingAmount = 0.02;
        this.randomSeed = Math.random();
        this.port.onmessage = (e) => this._handleMessage(e.data);
    }

    _handleMessage(data) {
        switch (data.type) {
            case 'setParam': this._setParam(data.name, data.value); break;
            case 'setMode': this.mode = data.mode === 'micro' ? 'micro' : 'macro'; break;
            case 'setBend': this.bendEnabled = data.enabled; break;
            case 'setBreak': this.breakEnabled = data.enabled; break;
            case 'setCorruptType': this.corruptType = Math.max(0, Math.min(4, Math.round(data.value))); break;
            case 'freeze': this._handleFreeze(data.active); break;
            case 'purge': this._purge(); break;
        }
    }

    _setParam(name, value) {
        switch (name) {
            case 'time': this._setTime(value); break;
            case 'repeats': this.repeats = Math.max(1, Math.floor(1 + Math.max(0, Math.min(1, value)) * 63)); break;
            case 'mix': this.targetMix = this.mix = Math.max(0, Math.min(1, value)); break;
            case 'bend':
                this.bendAmount = Math.max(0, Math.min(1, value));
                if (this.mode === 'micro') this.microBendPitch = Math.pow(2, (value - 0.5) * 6);
                break;
            case 'break':
                this.breakAmount = Math.max(0, Math.min(1, value));
                if (this.mode === 'micro') {
                    if (this.breakMicroMode === 'traverse') this.traversePosition = value;
                    else this.silenceAmount = value * 0.9;
                }
                break;
            case 'corrupt': this.corruptAmount = Math.max(0, Math.min(1, value)); break;
            case 'stereoWidth': this.stereoWidth = Math.max(0, Math.min(1, value)); break;
        }
    }

    _setTime(normalized) {
        const minPeriod = 1 / 80, maxPeriod = 16;
        const period = maxPeriod * Math.pow(minPeriod / maxPeriod, normalized);
        this.internalClockRate = 1 / period;
        this.targetBufferLength = Math.max(128, Math.min(MAX_BUFFER_SAMPLES - 1, Math.floor(period * this.sampleRate)));
    }

    _handleFreeze(active) {
        if (active && !this.freezeActive) { this.freezeLength = this.bufferLength; this.freezeActive = true; }
        else if (!active) this.freezeActive = false;
    }

    _purge() { this.bufferL.fill(0); this.bufferR.fill(0); this.writeHead = 0; this.playHead = 0; }

    _pseudoRandom() { this.randomSeed = (this.randomSeed * 9301 + 49297) % 233280; return this.randomSeed / 233280; }

    _rollMacroBend() {
        if (!this.bendEnabled || this.bendAmount < 0.01) return { speed: 1, reversed: false };
        const rand = this._pseudoRandom(), amount = this.bendAmount;
        let speed = 1, reversed = false;
        if (amount > 0 && rand < amount * 0.3) reversed = Math.random() < 0.5;
        if (amount > 0.17 && rand < amount * 0.4) speed = [0.5, 1, 2][Math.floor(Math.random() * 3)];
        if (amount > 0.33 && rand < amount * 0.5) speed = [0.25, 0.5, 1, 2, 4][Math.floor(Math.random() * 5)];
        if (amount > 0.5 && rand < amount * 0.2) { this.tapeStopActive = true; this.tapeStopProgress = 0; }
        if (amount > 0.67) this.slewActive = true;
        return { speed, reversed };
    }

    _rollMacroBreak() {
        if (!this.breakEnabled || this.breakAmount < 0.01) return { section: 0, silence: false };
        const rand = this._pseudoRandom(), amount = this.breakAmount;
        let section = 0, silence = false;
        if (amount > 0 && rand < amount * 0.3) section = Math.floor(Math.random() * 2);
        if (amount > 0.17 && rand < amount * 0.4) section = Math.floor(Math.random() * Math.min(8, this.repeats));
        if (amount > 0.33 && rand < amount * 0.5) section = Math.floor(Math.random() * this.repeats);
        if (amount > 0.67 && rand < amount * 0.4) silence = Math.random() < 0.5;
        return { section, silence };
    }

    _processDecimate(sampleL, sampleR) {
        if (this.corruptAmount < 0.01) return [sampleL, sampleR];
        const variations = [{ bits: 16, rate: 1 }, { bits: 12, rate: 2 }, { bits: 10, rate: 4 }, { bits: 8, rate: 8 }, { bits: 6, rate: 16 }, { bits: 4, rate: 32 }, { bits: 3, rate: 64 }, { bits: 2, rate: 128 }];
        const v = variations[Math.floor(this.corruptAmount * (variations.length - 0.01))];
        this.decimateCounter++;
        if (this.decimateCounter >= v.rate) { this.decimateCounter = 0; this.decimateHoldL = sampleL; this.decimateHoldR = sampleR; }
        let outL = this.decimateHoldL || sampleL, outR = this.decimateHoldR || sampleR;
        const levels = Math.pow(2, v.bits);
        return [Math.round(outL * levels) / levels, Math.round(outR * levels) / levels];
    }

    _processDropout(sampleL, sampleR) {
        if (this.corruptAmount < 0.01) return [sampleL, sampleR];
        if (!this.dropoutActive && Math.random() < this.corruptAmount * 0.01) {
            this.dropoutActive = true;
            this.dropoutLength = Math.floor(this.sampleRate * 0.001 + Math.random() * this.sampleRate * 0.5 * (1 - this.corruptAmount * 0.8));
            this.dropoutCounter = 0;
        }
        if (this.dropoutActive) { this.dropoutCounter++; if (this.dropoutCounter >= this.dropoutLength) this.dropoutActive = false; return [0, 0]; }
        return [sampleL, sampleR];
    }

    _processDestroy(sampleL, sampleR) {
        if (this.corruptAmount < 0.01) return [sampleL, sampleR];
        const amount = this.corruptAmount;
        if (amount < 0.5) { const drive = 1 + amount * 4; return [Math.tanh(sampleL * drive) / Math.tanh(drive), Math.tanh(sampleR * drive) / Math.tanh(drive)]; }
        const drive = 1 + (amount - 0.5) * 20;
        let outL = Math.max(-1, Math.min(1, sampleL * drive)) - 0.3 * Math.pow(Math.max(-1, Math.min(1, sampleL * drive)), 3);
        let outR = Math.max(-1, Math.min(1, sampleR * drive)) - 0.3 * Math.pow(Math.max(-1, Math.min(1, sampleR * drive)), 3);
        return [outL, outR];
    }

    _processDJFilter(sampleL, sampleR) {
        if (Math.abs(this.corruptAmount - 0.5) < 0.02) return [sampleL, sampleR];
        const isLowpass = this.corruptAmount < 0.5;
        const filterAmount = isLowpass ? (0.5 - this.corruptAmount) * 2 : (this.corruptAmount - 0.5) * 2;
        let cutoff = isLowpass ? 20000 * Math.pow(0.005, filterAmount) : 20 + filterAmount * 7980;
        const Q = 1.5 + filterAmount * 2;
        const omega = 2 * Math.PI * cutoff / this.sampleRate, sin = Math.sin(omega), cos = Math.cos(omega), alpha = sin / (2 * Q), a0 = 1 + alpha;
        let b0, b1, b2;
        if (isLowpass) { b0 = ((1 - cos) / 2) / a0; b1 = (1 - cos) / a0; b2 = ((1 - cos) / 2) / a0; }
        else { b0 = ((1 + cos) / 2) / a0; b1 = -(1 + cos) / a0; b2 = ((1 + cos) / 2) / a0; }
        const a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
        const outL = b0 * sampleL + b1 * this.djFilterState.x1 + b2 * this.djFilterState.x2 - a1 * this.djFilterState.y1 - a2 * this.djFilterState.y2;
        this.djFilterState.x2 = this.djFilterState.x1; this.djFilterState.x1 = sampleL; this.djFilterState.y2 = this.djFilterState.y1; this.djFilterState.y1 = outL;
        const outR = b0 * sampleR + b1 * this.djFilterStateR.x1 + b2 * this.djFilterStateR.x2 - a1 * this.djFilterStateR.y1 - a2 * this.djFilterStateR.y2;
        this.djFilterStateR.x2 = this.djFilterStateR.x1; this.djFilterStateR.x1 = sampleR; this.djFilterStateR.y2 = this.djFilterStateR.y1; this.djFilterStateR.y1 = outR;
        return [outL, outR];
    }

    _processVinylSim(sampleL, sampleR) {
        if (this.corruptAmount < 0.01) return [sampleL, sampleR];
        const amount = this.corruptAmount;
        let outL = sampleL + (Math.random() * 2 - 1) * amount * 0.02;
        let outR = sampleR + (Math.random() * 2 - 1) * amount * 0.02;
        this.vinylClickTimer--;
        if (this.vinylClickTimer <= 0) {
            this.vinylClickTimer = Math.floor(this.sampleRate * (2 - amount * 1.8) * (0.5 + Math.random()));
            const vol = 0.1 + Math.random() * 0.3 * amount;
            if (Math.random() < 0.5) outL += vol * (Math.random() > 0.5 ? 1 : -1);
            else outR += vol * (Math.random() > 0.5 ? 1 : -1);
        }
        return [outL, outR];
    }

    _processCorrupt(sampleL, sampleR) {
        if (this.corruptAmount < 0.01) return [sampleL, sampleR];
        switch (this.corruptType) {
            case CORRUPT_DECIMATE: return this._processDecimate(sampleL, sampleR);
            case CORRUPT_DROPOUT: return this._processDropout(sampleL, sampleR);
            case CORRUPT_DESTROY: return this._processDestroy(sampleL, sampleR);
            case CORRUPT_DJFILTER: return this._processDJFilter(sampleL, sampleR);
            case CORRUPT_VINYLSIM: return this._processVinylSim(sampleL, sampleR);
            default: return [sampleL, sampleR];
        }
    }

    _applyWindow(sample, phase, length) {
        if (this.windowingAmount < 0.001) return sample;
        const windowSamples = Math.floor(length * this.windowingAmount);
        if (windowSamples < 2) return sample;
        const position = phase * length;
        if (position < windowSamples) return sample * (0.5 - 0.5 * Math.cos(Math.PI * position / windowSamples));
        if (position > length - windowSamples) return sample * (0.5 - 0.5 * Math.cos(Math.PI * (length - position) / windowSamples));
        return sample;
    }

    _applyStereoWidth(sampleL, sampleR) {
        if (this.stereoWidth < 0.01) return [sampleL, sampleR];
        const mid = (sampleL + sampleR) * 0.5, side = (sampleL - sampleR) * 0.5 * (1 + this.stereoWidth * 2);
        return [mid + side, mid - side];
    }

    _readBuffer(channel, position) {
        const buffer = channel === 'L' ? this.bufferL : this.bufferR;
        const length = this.freezeActive ? this.freezeLength : this.bufferLength;
        const wrappedPos = ((position % length) + length) % length;
        const floor = Math.floor(wrappedPos), frac = wrappedPos - floor, next = (floor + 1) % MAX_BUFFER_SAMPLES;
        return buffer[floor] * (1 - frac) + buffer[next] * frac;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0], output = outputs[0];
        if (!input || !input[0]) return true;
        const inputL = input[0], inputR = input[1] || input[0], outputL = output[0], outputR = output[1] || output[0];
        this.bufferLength += (this.targetBufferLength - this.bufferLength) * 0.0001;
        this.mix += (this.targetMix - this.mix) * 0.001;

        for (let i = 0; i < inputL.length; i++) {
            const inL = inputL[i], inR = inputR[i];
            if (!this.freezeActive) { this.bufferL[this.writeHead] = inL; this.bufferR[this.writeHead] = inR; this.writeHead = (this.writeHead + 1) % MAX_BUFFER_SAMPLES; }
            const activeBufferLength = this.freezeActive ? this.freezeLength : this.bufferLength;
            const repeatLength = activeBufferLength / this.repeats;
            let section = this.currentRepeat, phaseInRepeat = this.repeatPhase;
            if (this.mode === 'micro' && this.breakMicroMode === 'traverse' && this.repeats > 1) section = Math.min(Math.floor(this.traversePosition * this.repeats), this.repeats - 1);
            const basePosition = section * repeatLength + phaseInRepeat * repeatLength;
            let silenceFactor = 1;
            if (this.mode === 'micro' && this.breakMicroMode === 'silence') { this.silencePhase = (this.silencePhase + 1 / repeatLength) % 1; if (this.silencePhase > (1 - this.silenceAmount)) silenceFactor = 0; }
            let wetL = this._readBuffer('L', basePosition) * silenceFactor, wetR = this._readBuffer('R', basePosition) * silenceFactor;
            wetL = this._applyWindow(wetL, phaseInRepeat, repeatLength); wetR = this._applyWindow(wetR, phaseInRepeat, repeatLength);
            [wetL, wetR] = this._processCorrupt(wetL, wetR);
            [wetL, wetR] = this._applyStereoWidth(wetL, wetR);
            outputL[i] = inL * (1 - this.mix) + wetL * this.mix; outputR[i] = inR * (1 - this.mix) + wetR * this.mix;
            let playbackSpeed = this.mode === 'micro' ? this.microBendPitch * (this.microBendReverse ? -1 : 1) : (this.bendEnabled ? this.currentPlaybackSpeed * (this.isReversed ? -1 : 1) : 1);
            if (this.tapeStopActive) { this.tapeStopProgress += 0.00005; playbackSpeed *= Math.max(0, 1 - this.tapeStopProgress); if (this.tapeStopProgress >= 1) { this.tapeStopActive = false; this.tapeStopProgress = 0; } }
            if (this.slewActive) this.currentPlaybackSpeed += (this.targetPlaybackSpeed - this.currentPlaybackSpeed) * 0.001;
            this.repeatPhase += Math.abs(playbackSpeed) / repeatLength;
            if (this.repeatPhase >= 1) {
                this.repeatPhase = 0;
                this.currentRepeat = playbackSpeed >= 0 ? (this.currentRepeat + 1) % this.repeats : (this.currentRepeat - 1 + this.repeats) % this.repeats;
                if (this.mode === 'macro') {
                    if (this.bendEnabled && this.bendAmount > 0.01) { const r = this._rollMacroBend(); this.targetPlaybackSpeed = r.speed; this.isReversed = r.reversed; if (!this.slewActive) this.currentPlaybackSpeed = this.targetPlaybackSpeed; }
                    if (this.breakEnabled && this.breakAmount > 0.01) { const r = this._rollMacroBreak(); if (r.section !== undefined) this.currentRepeat = r.section % this.repeats; }
                }
            }
        }
        return true;
    }
}
registerProcessor('databender-processor', DataBenderProcessor);
`;

export class DataBenderAdapter extends ExternalEffectWrapper {
  constructor(audioContext, slot) {
    super('databender', audioContext, slot);

    this.params = {
      mix: 0.5,
      time: 0.5,
      repeats: 0,
      bend: 0,
      break: 0,
      corrupt: 0,
      corruptType: 0,
      stereoWidth: 0,
      mode: 0,
      freeze: 0
    };
  }

  async initialize() {
    const blob = new Blob([DATABENDER_PROCESSOR_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      await this.ctx.audioWorklet.addModule(url);
    } catch (e) {
      if (!e.message.includes('already been added')) {
        console.warn('DataBenderAdapter: Worklet registration note:', e.message);
      }
    }

    URL.revokeObjectURL(url);

    this.workletNode = new AudioWorkletNode(this.ctx, 'databender-processor', {
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
      console.warn(`DataBenderAdapter: Unknown parameter "${name}"`);
      return;
    }
    this.params[name] = value;

    if (name === 'mode') {
      this.workletNode?.port.postMessage({ type: 'setMode', mode: value > 0.5 ? 'micro' : 'macro' });
      return;
    }
    if (name === 'corruptType') {
      this.workletNode?.port.postMessage({ type: 'setCorruptType', value: Math.floor(value) });
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

  setBend(enabled) { this.workletNode?.port.postMessage({ type: 'setBend', enabled }); }
  setBreak(enabled) { this.workletNode?.port.postMessage({ type: 'setBreak', enabled }); }
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

registerExternalEffect('databender', DataBenderAdapter);
