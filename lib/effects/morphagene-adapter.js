// ============================================================================
// MORPHAGENE ADAPTER
// Integrates Make Noise Morphagene into pedalboard system
// ============================================================================

import { ExternalEffectWrapper, registerExternalEffect } from '../effect-wrapper.js';

// Inline processor code for blob URL loading
const MORPHAGENE_PROCESSOR_CODE = `
// MORPHAGENE PROCESSOR - AudioWorkletProcessor
// Make Noise / Soundhack Morphagene Emulation

const MAX_SAMPLE_RATE = 48000;
const REEL_DURATION = 174;
const SAMPLES_PER_REEL = MAX_SAMPLE_RATE * REEL_DURATION;
const MAX_SPLICES = 300;
const MIN_GENE_SIZE_MS = 1;
const MAX_GENE_SIZE_MS = 10000;
const VARISPEED_OCTAVES_UP = 1;
const VARISPEED_OCTAVES_DOWN = 2.17;
const MAX_MORPH_VOICES = 4;
const ENVELOPE_ATTACK_MS = 2;
const ENVELOPE_RELEASE_MS = 2;

class MorphageneVoice {
    constructor() {
        this.active = false;
        this.position = 0;
        this.geneStart = 0;
        this.geneEnd = 0;
        this.geneLength = 0;
        this.progress = 0;
        this.playbackRate = 1;
        this.direction = 1;
        this.pan = 0.5;
        this.pitchRatio = 1;
        this.amplitude = 1;
        this.envelopePhase = 0;
        this.envelopeValue = 0;
    }
    reset() {
        this.active = false;
        this.progress = 0;
        this.envelopePhase = 0;
        this.envelopeValue = 0;
    }
}

class MorphageneProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.sampleRate = options.processorOptions?.sampleRate || 48000;
        this.reelBufferL = new Float32Array(SAMPLES_PER_REEL);
        this.reelBufferR = new Float32Array(SAMPLES_PER_REEL);
        this.reelLength = 0;
        this.splices = [0];
        this.currentSplice = 0;
        this.nextSplice = 0;
        this.playheadPosition = 0;
        this.isPlaying = true;
        this.voices = [];
        for (let i = 0; i < MAX_MORPH_VOICES; i++) {
            this.voices.push(new MorphageneVoice());
        }
        this.activeVoiceCount = 1;
        this.geneCounter = 0;
        this.isRecording = false;
        this.recordWriteHead = 0;
        this.recordingStartPos = 0;
        this.params = {
            varispeed: 0.5,
            geneSize: 0,
            slide: 0,
            morph: 0.3,
            organize: 0,
            sos: 1,
            mix: 1
        };
        this.freezeActive = false;
        this.clockBPM = 120;
        this.externalClockActive = false;
        this.lastClockTime = 0;
        this.clockPeriodSamples = 0;
        this.timeStretchMode = false;
        this.geneShiftMode = false;
        this.morphChordRatios = [1, 2, 3, 4];
        this.smoothedSOS = 1;
        this.smoothedMix = 1;
        this.smoothedVarispeed = 0;
        this.envelopeAttackSamples = Math.floor(ENVELOPE_ATTACK_MS * this.sampleRate / 1000);
        this.envelopeReleaseSamples = Math.floor(ENVELOPE_RELEASE_MS * this.sampleRate / 1000);
        this.eosgTrigger = false;
        this.eosgCounter = 0;
        this.cvOutputValue = 0;
        this.cvEnvelopeAttack = 0.01;
        this.cvEnvelopeRelease = 0.001;
        this.port.onmessage = (e) => this._handleMessage(e.data);
    }

    _handleMessage(data) {
        switch (data.type) {
            case 'setParam':
                this._setParam(data.name, data.value);
                break;
            case 'startRecording':
                this._startRecording(data.newSplice);
                break;
            case 'stopRecording':
                this._stopRecording();
                break;
            case 'createSplice':
                this._createSpliceMarker();
                break;
            case 'deleteSpliceMarker':
                this._deleteSpliceMarker();
                break;
            case 'deleteSpliceAudio':
                this._deleteSpliceAudio();
                break;
            case 'deleteAllSpliceMarkers':
                this._deleteAllSpliceMarkers();
                break;
            case 'clearReel':
                this._clearReel();
                break;
            case 'shiftSplice':
                this._shiftSplice();
                break;
            case 'setPlay':
                this.isPlaying = !!data.active;
                break;
            case 'freeze':
                this.freezeActive = !!data.active;
                break;
            case 'clockPulse':
                this._handleClockPulse();
                break;
            case 'setBPM':
                this.clockBPM = Math.max(20, Math.min(300, data.bpm));
                this._updateClockPeriod();
                break;
            case 'setExternalClock':
                this.externalClockActive = !!data.enabled;
                break;
            case 'loadBuffer':
                this._loadBuffer(data.bufferL, data.bufferR, data.splices);
                break;
        }
    }

    _setParam(name, value) {
        if (name in this.params) {
            this.params[name] = value;
            if (name === 'organize') this._updateOrganize();
        }
    }

    _loadBuffer(bufferL, bufferR, splices) {
        const length = Math.min(bufferL.length, SAMPLES_PER_REEL);
        this.reelBufferL.set(bufferL.slice(0, length));
        this.reelBufferR.set(bufferR.slice(0, length));
        this.reelLength = length;
        if (splices && splices.length > 0) {
            this.splices = [0, ...splices.filter(s => s > 0 && s < length)];
            this.splices.sort((a, b) => a - b);
        } else {
            this.splices = [0];
        }
        this.currentSplice = 0;
        this.nextSplice = 0;
        this.playheadPosition = 0;
        for (const voice of this.voices) voice.reset();
    }

    _startRecording(newSplice = false) {
        if (newSplice) {
            this.recordWriteHead = this.reelLength;
            this.recordingStartPos = this.reelLength;
            if (this.reelLength > 0 && !this.splices.includes(this.reelLength)) {
                this.splices.push(this.reelLength);
            }
        } else {
            const spliceStart = this._getSpliceStart(this.currentSplice);
            this.recordWriteHead = spliceStart;
            this.recordingStartPos = spliceStart;
        }
        this.isRecording = true;
    }

    _stopRecording() {
        this.isRecording = false;
        const recordingStartPos = this.recordingStartPos;
        const recordingEndPos = this.recordWriteHead;
        const recordedLength = recordingEndPos - recordingStartPos;
        if (this.recordWriteHead > this.reelLength) this.reelLength = this.recordWriteHead;
        if (recordedLength > 0) {
            let recordingSpliceIndex = 0;
            for (let i = this.splices.length - 1; i >= 0; i--) {
                if (this.splices[i] <= recordingStartPos) { recordingSpliceIndex = i; break; }
            }
            this.currentSplice = recordingSpliceIndex;
            this.nextSplice = recordingSpliceIndex;
            this.playheadPosition = recordingStartPos;
            for (const voice of this.voices) voice.reset();
            this.geneCounter = 999999;
            if (Math.abs(this.params.varispeed - 0.5) < 0.05) {
                this.params.varispeed = 0.75;
                this.smoothedVarispeed = 0.5;
            }
        }
        this.port.postMessage({
            type: 'recordingStopped',
            reelLength: this.reelLength,
            spliceCount: this.splices.length,
            currentSplice: this.currentSplice,
            playheadPosition: this.playheadPosition,
            varispeed: this.params.varispeed
        });
    }

    _createSpliceMarker() {
        const pos = Math.floor(this.playheadPosition);
        if (pos > 0 && pos < this.reelLength && !this.splices.includes(pos)) {
            this.splices.push(pos);
            this.splices.sort((a, b) => a - b);
            if (this.splices.length > MAX_SPLICES + 1) this.splices.splice(1, 1);
        }
    }

    _deleteSpliceMarker() {
        if (this.splices.length > 1 && this.currentSplice < this.splices.length - 1) {
            this.splices.splice(this.currentSplice + 1, 1);
        }
    }

    _deleteSpliceAudio() {
        const start = this._getSpliceStart(this.currentSplice);
        const end = this._getSpliceEnd(this.currentSplice);
        const spliceLength = end - start;
        if (spliceLength > 0 && end <= this.reelLength) {
            const remaining = this.reelLength - end;
            if (remaining > 0) {
                this.reelBufferL.copyWithin(start, end, this.reelLength);
                this.reelBufferR.copyWithin(start, end, this.reelLength);
            }
            this.reelLength -= spliceLength;
            for (let i = this.currentSplice + 1; i < this.splices.length; i++) this.splices[i] -= spliceLength;
            if (this.currentSplice > 0) {
                this.splices.splice(this.currentSplice, 1);
                this.currentSplice = Math.max(0, this.currentSplice - 1);
            }
        }
    }

    _deleteAllSpliceMarkers() {
        this.splices = [0];
        this.currentSplice = 0;
        this.nextSplice = 0;
    }

    _clearReel() {
        this.reelBufferL.fill(0);
        this.reelBufferR.fill(0);
        this.reelLength = 0;
        this.splices = [0];
        this.currentSplice = 0;
        this.nextSplice = 0;
        this.playheadPosition = 0;
        for (const voice of this.voices) voice.reset();
    }

    _shiftSplice() {
        if (this.splices.length > 1) this.nextSplice = (this.currentSplice + 1) % this.splices.length;
    }

    _getSpliceStart(index) {
        if (index < 0 || index >= this.splices.length) return 0;
        return this.splices[index];
    }

    _getSpliceEnd(index) {
        if (index < 0) return this.reelLength;
        if (index >= this.splices.length - 1) return this.reelLength;
        return this.splices[index + 1];
    }

    _getSpliceLength(index) {
        return this._getSpliceEnd(index) - this._getSpliceStart(index);
    }

    _updateOrganize() {
        const spliceCount = this.splices.length;
        if (spliceCount <= 1) { this.nextSplice = 0; return; }
        const targetIndex = Math.floor(this.params.organize * spliceCount);
        this.nextSplice = Math.min(targetIndex, spliceCount - 1);
    }

    _updateClockPeriod() {
        this.clockPeriodSamples = Math.floor((60 / this.clockBPM) * this.sampleRate);
    }

    _handleClockPulse() {
        if (this.params.morph < 0.37) this._geneShift();
        else this._timeStretchPulse();
    }

    _geneShift() {
        const spliceStart = this._getSpliceStart(this.currentSplice);
        const spliceLength = this._getSpliceLength(this.currentSplice);
        const geneLength = this._getGeneLengthSamples();
        this.playheadPosition += geneLength;
        if (this.playheadPosition >= spliceStart + spliceLength) {
            this.playheadPosition = spliceStart + ((this.playheadPosition - spliceStart) % spliceLength);
        }
    }

    _timeStretchPulse() {
        const spliceStart = this._getSpliceStart(this.currentSplice);
        const spliceLength = this._getSpliceLength(this.currentSplice);
        const geneLength = this._getGeneLengthSamples();
        this.playheadPosition += geneLength;
        if (this.playheadPosition >= spliceStart + spliceLength) this.playheadPosition = spliceStart;
    }

    _getPlaybackRate() {
        const normalized = this.params.varispeed;
        if (Math.abs(normalized - 0.5) < 0.02) return 0;
        if (normalized > 0.5) {
            const forwardAmount = (normalized - 0.5) * 2;
            if (forwardAmount < 0.5) return forwardAmount * 2;
            else {
                const t = (forwardAmount - 0.5) * 2;
                return Math.pow(2, t);
            }
        } else {
            const reverseAmount = (0.5 - normalized) * 2;
            if (reverseAmount < 0.5) return -(reverseAmount * 2);
            else {
                const t = (reverseAmount - 0.5) * 2;
                const semitones = -t * 26;
                return -Math.pow(2, semitones / 12);
            }
        }
    }

    _getGeneLengthSamples() {
        const spliceLength = this._getSpliceLength(this.currentSplice);
        if (spliceLength <= 0) return this.sampleRate * 0.01;
        const geneSize = this.params.geneSize;
        if (geneSize < 0.01) return spliceLength;
        const minSamples = Math.floor(MIN_GENE_SIZE_MS * this.sampleRate / 1000);
        const maxSamples = spliceLength;
        const logMin = Math.log(minSamples);
        const logMax = Math.log(maxSamples);
        const logValue = logMax - geneSize * (logMax - logMin);
        return Math.floor(Math.exp(logValue));
    }

    _getMorphSettings() {
        const morph = this.params.morph;
        let voiceCount = 1, gapRatio = 0, overlapRatio = 0, enablePanning = false, enablePitchUp = false;
        if (morph < 0.3) { voiceCount = 1; gapRatio = 0.3 - morph; overlapRatio = 0; }
        else if (morph < 0.35) { voiceCount = 1; gapRatio = 0; overlapRatio = 0; }
        else if (morph < 0.5) { voiceCount = 2; overlapRatio = (morph - 0.35) / 0.15; }
        else if (morph < 0.55) { voiceCount = 3; overlapRatio = 1; enablePanning = true; }
        else { voiceCount = 4; overlapRatio = 1; enablePanning = true; enablePitchUp = true; }
        return { voiceCount, gapRatio, overlapRatio, enablePanning, enablePitchUp };
    }

    _spawnVoice(voiceIndex, geneStart, geneLength, playbackRate, morphSettings) {
        const voice = this.voices[voiceIndex];
        if (Math.abs(playbackRate) < 0.01) return;
        voice.active = true;
        voice.geneStart = geneStart;
        voice.geneLength = geneLength;
        voice.geneEnd = geneStart + geneLength;
        voice.direction = playbackRate >= 0 ? 1 : -1;
        voice.playbackRate = Math.abs(playbackRate);
        if (voice.direction < 0) { voice.position = voice.geneEnd - 1; voice.progress = 1; }
        else { voice.position = geneStart; voice.progress = 0; }
        voice.envelopePhase = 0;
        voice.envelopeValue = 0;
        voice.amplitude = 1 / Math.sqrt(morphSettings.voiceCount);
        if (morphSettings.enablePitchUp && voiceIndex > 0) voice.pitchRatio = this.morphChordRatios[voiceIndex];
        else voice.pitchRatio = 1;
        if (morphSettings.enablePanning && morphSettings.voiceCount > 1) voice.pan = voiceIndex / (morphSettings.voiceCount - 1);
        else voice.pan = 0.5;
    }

    _processVoice(voice, outputL, outputR, sampleIndex) {
        if (!voice.active) return;
        switch (voice.envelopePhase) {
            case 0:
                voice.envelopeValue += 1 / this.envelopeAttackSamples;
                if (voice.envelopeValue >= 1) { voice.envelopeValue = 1; voice.envelopePhase = 1; }
                break;
            case 1:
                const remainingProgress = 1 - voice.progress;
                const releaseProgress = this.envelopeReleaseSamples / voice.geneLength;
                if (remainingProgress <= releaseProgress) voice.envelopePhase = 2;
                break;
            case 2:
                voice.envelopeValue -= 1 / this.envelopeReleaseSamples;
                if (voice.envelopeValue <= 0) { voice.envelopeValue = 0; voice.active = false; return; }
                break;
        }
        const readPos = voice.position;
        const readPosInt = Math.floor(readPos);
        const frac = readPos - readPosInt;
        const idx0 = ((readPosInt % this.reelLength) + this.reelLength) % this.reelLength;
        const idx1 = ((readPosInt + 1) % this.reelLength + this.reelLength) % this.reelLength;
        const sampleL = this.reelBufferL[idx0] * (1 - frac) + this.reelBufferL[idx1] * frac;
        const sampleR = this.reelBufferR[idx0] * (1 - frac) + this.reelBufferR[idx1] * frac;
        const amp = voice.envelopeValue * voice.amplitude;
        const panAngle = voice.pan * Math.PI * 0.5;
        const panL = Math.cos(panAngle);
        const panR = Math.sin(panAngle);
        outputL[sampleIndex] += sampleL * amp * panL;
        outputR[sampleIndex] += sampleR * amp * panR;
        const effectiveRate = voice.playbackRate * voice.pitchRatio * voice.direction;
        voice.position += effectiveRate;
        if (voice.direction > 0) voice.progress = (voice.position - voice.geneStart) / voice.geneLength;
        else voice.progress = (voice.geneEnd - voice.position) / voice.geneLength;
        if (voice.direction > 0 && voice.position >= voice.geneEnd) voice.active = false;
        else if (voice.direction < 0 && voice.position <= voice.geneStart) voice.active = false;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!output || !output[0]) return true;
        const outputL = output[0];
        const outputR = output[1] || output[0];
        const hasInput = input && input[0] && input[0].length > 0;
        const inputL = hasInput ? input[0] : new Float32Array(outputL.length);
        const inputR = hasInput ? (input[1] || input[0]) : new Float32Array(outputR.length);

        const playbackRate = this._getPlaybackRate();
        const geneLength = this._getGeneLengthSamples();
        const morphSettings = this._getMorphSettings();
        const spliceStart = this._getSpliceStart(this.currentSplice);
        const spliceEnd = this._getSpliceEnd(this.currentSplice);
        const spliceLength = spliceEnd - spliceStart;

        let geneSpawnInterval = geneLength;
        if (morphSettings.voiceCount > 1 && morphSettings.overlapRatio > 0) {
            geneSpawnInterval = Math.floor(geneLength / morphSettings.voiceCount);
        }

        this.smoothedSOS += (this.params.sos - this.smoothedSOS) * 0.001;
        this.smoothedMix += (this.params.mix - this.smoothedMix) * 0.001;
        const varispeedDiff = playbackRate - this.smoothedVarispeed;
        const smoothingFactor = Math.abs(varispeedDiff) > 0.5 ? 0.05 : 0.02;
        this.smoothedVarispeed += varispeedDiff * smoothingFactor;

        for (let i = 0; i < outputL.length; i++) {
            const inL = inputL[i] || 0;
            const inR = inputR[i] || 0;

            if (this.isRecording && !this.freezeActive) {
                if (this.recordWriteHead < SAMPLES_PER_REEL) {
                    this.reelBufferL[this.recordWriteHead] = inL;
                    this.reelBufferR[this.recordWriteHead] = inR;
                    this.recordWriteHead++;
                    if (this.recordWriteHead >= SAMPLES_PER_REEL) this._stopRecording();
                }
            }

            let playbackL = 0, playbackR = 0;

            if (this.reelLength > 0 && this.isPlaying && spliceLength > 0) {
                const slideOffset = Math.floor(this.params.slide * spliceLength);
                const geneStart = spliceStart + ((Math.floor(this.playheadPosition) - spliceStart + slideOffset) % spliceLength);
                this.geneCounter++;
                const targetRate = playbackRate;

                if ((this.geneCounter >= geneSpawnInterval || !this.voices[0].active) && Math.abs(targetRate) > 0.01) {
                    this.geneCounter = 0;
                    for (let v = 0; v < morphSettings.voiceCount; v++) {
                        const voiceOffset = Math.floor(v * geneLength / morphSettings.voiceCount);
                        const voiceStart = spliceStart + ((geneStart - spliceStart + voiceOffset) % spliceLength);
                        if (!this.voices[v].active) {
                            this._spawnVoice(v, voiceStart, geneLength, targetRate, morphSettings);
                        }
                    }
                    this.eosgTrigger = true;
                    this.eosgCounter = Math.floor(this.sampleRate * 0.01);
                }

                for (const voice of this.voices) this._processVoice(voice, outputL, outputR, i);
                playbackL = outputL[i];
                playbackR = outputR[i];
                outputL[i] = 0;
                outputR[i] = 0;

                if (!this.externalClockActive) {
                    this.playheadPosition += this.smoothedVarispeed;
                    if (this.smoothedVarispeed > 0) {
                        if (this.playheadPosition >= spliceEnd) {
                            if (this.nextSplice !== this.currentSplice) this.currentSplice = this.nextSplice;
                            this.playheadPosition = this._getSpliceStart(this.currentSplice);
                        }
                    } else if (this.smoothedVarispeed < 0) {
                        if (this.playheadPosition < spliceStart) {
                            if (this.nextSplice !== this.currentSplice) this.currentSplice = this.nextSplice;
                            this.playheadPosition = this._getSpliceEnd(this.currentSplice) - 1;
                        }
                    }
                }

                if (morphSettings.gapRatio > 0 && this.geneCounter < geneSpawnInterval * morphSettings.gapRatio) {
                    playbackL = 0; playbackR = 0;
                }
            }

            const sosL = inL * (1 - this.smoothedSOS) + playbackL * this.smoothedSOS;
            const sosR = inR * (1 - this.smoothedSOS) + playbackR * this.smoothedSOS;
            outputL[i] = inL * (1 - this.smoothedMix) + sosL * this.smoothedMix;
            outputR[i] = inR * (1 - this.smoothedMix) + sosR * this.smoothedMix;

            const outputLevel = Math.max(Math.abs(outputL[i]), Math.abs(outputR[i]));
            if (outputLevel > this.cvOutputValue) this.cvOutputValue += (outputLevel - this.cvOutputValue) * this.cvEnvelopeAttack;
            else this.cvOutputValue += (outputLevel - this.cvOutputValue) * this.cvEnvelopeRelease;
            if (this.eosgCounter > 0) this.eosgCounter--;
        }

        if (this.eosgTrigger) { this.port.postMessage({ type: 'eosg' }); this.eosgTrigger = false; }
        return true;
    }
}

registerProcessor('morphagene-processor', MorphageneProcessor);
`;

export class MorphageneAdapter extends ExternalEffectWrapper {
  constructor(audioContext, slot) {
    super('morphagene', audioContext, slot);

    this.params = {
      varispeed: 0.5,
      geneSize: 0,
      slide: 0,
      morph: 0.3,
      organize: 0,
      sos: 1,
      mix: 1,
      freeze: 0
    };
  }

  async initialize() {
    const blob = new Blob([MORPHAGENE_PROCESSOR_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      await this.ctx.audioWorklet.addModule(url);
    } catch (e) {
      if (!e.message.includes('already been added')) {
        console.warn('MorphageneAdapter: Worklet registration note:', e.message);
      }
    }

    URL.revokeObjectURL(url);

    this.workletNode = new AudioWorkletNode(this.ctx, 'morphagene-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        sampleRate: this.ctx.sampleRate
      }
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

    // Listen for messages from processor
    this.workletNode.port.onmessage = (e) => {
      if (e.data.type === 'eosg' && this.onEOSG) {
        this.onEOSG();
      } else if (e.data.type === 'recordingStopped' && this.onRecordingStopped) {
        this.onRecordingStopped(e.data);
      }
    };

    return this;
  }

  get input() {
    return this._inputGain;
  }

  get output() {
    return this._outputGain;
  }

  setParam(name, value) {
    if (!(name in this.params)) {
      console.warn(`MorphageneAdapter: Unknown parameter "${name}"`);
      return;
    }

    this.params[name] = value;

    if (name === 'freeze') {
      this.workletNode?.port.postMessage({
        type: 'freeze',
        active: value > 0.5
      });
      return;
    }

    this.workletNode?.port.postMessage({
      type: 'setParam',
      name: name,
      value: value
    });
  }

  getParam(name) {
    return this.params[name];
  }

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

  // === SPECIAL CONTROLS ===

  startRecording(newSplice = false) {
    this.workletNode?.port.postMessage({ type: 'startRecording', newSplice });
  }

  stopRecording() {
    this.workletNode?.port.postMessage({ type: 'stopRecording' });
  }

  createSplice() {
    this.workletNode?.port.postMessage({ type: 'createSplice' });
  }

  deleteSpliceMarker() {
    this.workletNode?.port.postMessage({ type: 'deleteSpliceMarker' });
  }

  deleteSpliceAudio() {
    this.workletNode?.port.postMessage({ type: 'deleteSpliceAudio' });
  }

  deleteAllSpliceMarkers() {
    this.workletNode?.port.postMessage({ type: 'deleteAllSpliceMarkers' });
  }

  clearReel() {
    this.workletNode?.port.postMessage({ type: 'clearReel' });
  }

  shiftSplice() {
    this.workletNode?.port.postMessage({ type: 'shiftSplice' });
  }

  setPlay(active) {
    this.workletNode?.port.postMessage({ type: 'setPlay', active });
  }

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

registerExternalEffect('morphagene', MorphageneAdapter);
