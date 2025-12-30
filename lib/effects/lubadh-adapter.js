// ============================================================================
// LUBADH ADAPTER
// Integrates Instruō Lúbadh Dual Looper into pedalboard system
// ============================================================================

import { ExternalEffectWrapper, registerExternalEffect } from '../effect-wrapper.js';

// Inline processor code for blob URL loading (minified)
const LUBADH_PROCESSOR_CODE = `
const MAX_SAMPLE_RATE = 48000;
const REEL_DURATION = 600;
const SAMPLES_PER_DECK = MAX_SAMPLE_RATE * REEL_DURATION;
const MAX_CROSSFADE_MS = 250;
const MAX_TAPS = 4;
const TAPE_FILTER_FREQ = 8000;

class PlayheadTap {
    constructor() { this.active = false; this.position = 0; this.speed = 1; this.amplitude = 1; this.pan = 0.5; }
    reset() { this.active = false; this.position = 0; }
}

class DeckState {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.buffer = new Float32Array(SAMPLES_PER_DECK);
        this.recordedLength = 0;
        this.playheadPosition = 0;
        this.isPlaying = true;
        this.isRecording = false;
        this.isPunchIn = false;
        this.recordWriteHead = 0;
        this.recordMode = 'loop';
        this.playbackMode = 'loop';
        this.monitorMode = 'enabled';
        this.timeMode = 'clock';
        this.isArmed = false;
        this.taps = [];
        for (let i = 0; i < MAX_TAPS; i++) this.taps.push(new PlayheadTap());
        this.activeTapCount = 0;
        this.clockDivision = 1;
        this.clockCounter = 0;
        this.quantization = 0;
        this.crossfadePosition = 0;
        this.crossfadeActive = false;
        this.crossfadeLength = 0;
        this.oneShotPlaying = false;
    }
    reset() {
        this.buffer.fill(0);
        this.recordedLength = 0;
        this.playheadPosition = 0;
        this.isRecording = false;
        this.recordWriteHead = 0;
        for (const tap of this.taps) tap.reset();
        this.activeTapCount = 0;
    }
}

class LubadhProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.sampleRate = options.processorOptions?.sampleRate || 48000;
        this.deckA = new DeckState(this.sampleRate);
        this.deckB = new DeckState(this.sampleRate);
        this.params = {
            speedA: 0.75, startA: 0, lengthA: 1, inputLevelA: 0.5, outputLevelA: 1, dubLevelA: 0.9,
            speedB: 0.75, startB: 0, lengthB: 1, inputLevelB: 0.5, outputLevelB: 1, dubLevelB: 0.9,
            auxInputXfade: 0.5, auxOutputXfade: 0.5,
            tapeEmulation: 0.5, wowFlutter: 0.3, saturation: 0.4, tapeFilter: 0.5,
            crossfadeDuration: 0.5, mix: 1
        };
        this.linkEnabled = false;
        this.multiTapEnabled = false;
        this.clockBPM = 120;
        this.externalClockActive = false;
        this.clockPeriodSamples = 0;
        this._updateClockPeriod();
        this.wowPhase = 0;
        this.flutterPhase = 0;
        this.filterStateAL = 0;
        this.filterStateAR = 0;
        this.filterStateBL = 0;
        this.filterStateBR = 0;
        this.smoothedMix = 1;
        this.crossfadeSamples = Math.floor(MAX_CROSSFADE_MS * this.sampleRate / 1000);
        this.port.onmessage = (e) => this._handleMessage(e.data);
    }

    _handleMessage(data) {
        switch (data.type) {
            case 'setParam': this._setParam(data.name, data.value); break;
            case 'startRecording': this._startRecording(data.deck); break;
            case 'stopRecording': this._stopRecording(data.deck); break;
            case 'punchIn': this._punchIn(data.deck); break;
            case 'erase': this._erase(data.deck); break;
            case 'retrigger': this._retrigger(data.deck); break;
            case 'setLink': this.linkEnabled = !!data.enabled; break;
            case 'setMultiTap': this.multiTapEnabled = !!data.enabled; break;
            case 'addTap': this._addTap(data.deck); break;
            case 'removeTap': this._removeTap(data.deck); break;
            case 'clearTaps': this._clearTaps(data.deck); break;
            case 'setBPM': this.clockBPM = Math.max(20, Math.min(300, data.bpm)); this._updateClockPeriod(); break;
        }
    }

    _getDeck(deckId) { return deckId === 'A' ? this.deckA : this.deckB; }
    _setParam(name, value) { if (name in this.params) this.params[name] = value; }
    _updateClockPeriod() { this.clockPeriodSamples = Math.floor((60 / this.clockBPM) * this.sampleRate); }

    _startRecording(deckId) {
        const deck = this._getDeck(deckId);
        deck.recordWriteHead = deck.recordedLength === 0 ? 0 : Math.floor(deck.playheadPosition);
        deck.isRecording = true;
        deck.isPunchIn = false;
    }

    _stopRecording(deckId) {
        const deck = this._getDeck(deckId);
        if (!deck.isRecording) return;
        deck.isRecording = false;
        if (deck.recordedLength === 0 || deck.recordWriteHead > deck.recordedLength) {
            deck.recordedLength = deck.recordWriteHead;
        }
        deck.playheadPosition = 0;
        deck.isPlaying = true;
        this.port.postMessage({ type: 'recordingStopped', deck: deckId, recordedLength: deck.recordedLength });
    }

    _punchIn(deckId) {
        const deck = this._getDeck(deckId);
        deck.recordWriteHead = Math.floor(deck.playheadPosition);
        deck.isRecording = true;
        deck.isPunchIn = true;
    }

    _erase(deckId) { this._getDeck(deckId).reset(); }

    _retrigger(deckId) {
        const deck = this._getDeck(deckId);
        if (deck.recordedLength === 0) return;
        deck.playheadPosition = this._getLoopStart(deckId);
        if (deck.playbackMode === 'oneshot') deck.oneShotPlaying = true;
        for (const tap of deck.taps) { if (tap.active) tap.position = deck.playheadPosition; }
    }

    _addTap(deckId) {
        const deck = this._getDeck(deckId);
        for (const tap of deck.taps) {
            if (!tap.active) {
                tap.active = true;
                tap.position = deck.playheadPosition;
                tap.speed = this._getPlaybackRate(deckId);
                deck.activeTapCount++;
                for (const t of deck.taps) { if (t.active) t.amplitude = 1 / Math.sqrt(deck.activeTapCount + 1); }
                break;
            }
        }
    }

    _removeTap(deckId) {
        const deck = this._getDeck(deckId);
        for (let i = deck.taps.length - 1; i >= 0; i--) {
            if (deck.taps[i].active) {
                deck.taps[i].active = false;
                deck.activeTapCount = Math.max(0, deck.activeTapCount - 1);
                for (const t of deck.taps) { if (t.active) t.amplitude = 1 / Math.sqrt(Math.max(1, deck.activeTapCount + 1)); }
                break;
            }
        }
    }

    _clearTaps(deckId) {
        const deck = this._getDeck(deckId);
        for (const tap of deck.taps) tap.reset();
        deck.activeTapCount = 0;
    }

    _getPlaybackRate(deckId) {
        const normalized = deckId === 'A' ? this.params.speedA : this.params.speedB;
        if (Math.abs(normalized - 0.5) < 0.02) return 0;
        if (normalized > 0.5) {
            const forwardAmount = (normalized - 0.5) * 2;
            if (forwardAmount < 0.5) return forwardAmount * 2;
            return Math.pow(4, (forwardAmount - 0.5) * 2);
        } else {
            const reverseAmount = (0.5 - normalized) * 2;
            if (reverseAmount < 0.5) return -(reverseAmount * 2);
            return -Math.pow(4, (reverseAmount - 0.5) * 2);
        }
    }

    _getLoopStart(deckId) {
        const deck = this._getDeck(deckId);
        const start = deckId === 'A' ? this.params.startA : this.params.startB;
        if (deck.recordedLength === 0) return 0;
        let loopStart = Math.floor(start * deck.recordedLength);
        if (deck.quantization > 0) {
            const divisionSize = deck.recordedLength / deck.quantization;
            loopStart = Math.round(loopStart / divisionSize) * divisionSize;
        }
        return Math.max(0, Math.min(loopStart, deck.recordedLength - 1));
    }

    _getLoopLength(deckId) {
        const deck = this._getDeck(deckId);
        const length = deckId === 'A' ? this.params.lengthA : this.params.lengthB;
        if (deck.recordedLength === 0) return 0;
        const loopStart = this._getLoopStart(deckId);
        const maxLength = deck.recordedLength - loopStart;
        let loopLength = Math.floor(length * maxLength);
        if (deck.quantization > 0) {
            const divisionSize = deck.recordedLength / deck.quantization;
            loopLength = Math.max(divisionSize, Math.round(loopLength / divisionSize) * divisionSize);
        }
        return Math.max(Math.floor(this.sampleRate / 1000), Math.min(loopLength, maxLength));
    }

    _getLoopEnd(deckId) { return this._getLoopStart(deckId) + this._getLoopLength(deckId); }

    _applyTapeSaturation(sample, amount) {
        if (amount < 0.01) return sample;
        const drive = 1 + amount * 6;
        const saturated = Math.tanh(sample * drive) / Math.tanh(drive);
        const harmonic = sample * sample * amount * 0.1;
        return sample * (1 - amount) + (saturated + harmonic) * amount;
    }

    _applyTapeFilter(sample, filterState, amount) {
        if (amount < 0.01) return { sample, state: filterState };
        const cutoff = TAPE_FILTER_FREQ * (1 - amount * 0.8);
        const rc = 1 / (2 * Math.PI * cutoff);
        const dt = 1 / this.sampleRate;
        const alpha = dt / (rc + dt);
        const filtered = filterState + alpha * (sample - filterState);
        return { sample: filtered, state: filtered };
    }

    _getWowFlutter(amount) {
        if (amount < 0.01) return 0;
        const wow = Math.sin(this.wowPhase) * 0.015 * amount;
        const flutter = Math.sin(this.flutterPhase) * 0.004 * amount;
        const noise = (Math.random() - 0.5) * 0.001 * amount;
        this.wowPhase += (2 * Math.PI * 0.3) / this.sampleRate;
        this.flutterPhase += (2 * Math.PI * 5.5) / this.sampleRate;
        if (this.wowPhase > 2 * Math.PI) this.wowPhase -= 2 * Math.PI;
        if (this.flutterPhase > 2 * Math.PI) this.flutterPhase -= 2 * Math.PI;
        return wow + flutter + noise;
    }

    _getCrossfadeLength() { return Math.floor(this.params.crossfadeDuration * this.crossfadeSamples); }

    _calculateCrossfadeGain(position, loopStart, loopEnd, crossfadeLength) {
        if (crossfadeLength < 1) return { fadeIn: 1, fadeOut: 0 };
        const distanceFromStart = position - loopStart;
        const distanceFromEnd = loopEnd - position;
        let fadeIn = 1, fadeOut = 0;
        if (distanceFromStart < crossfadeLength) fadeIn = Math.sqrt(distanceFromStart / crossfadeLength);
        if (distanceFromEnd < crossfadeLength) fadeOut = Math.sqrt(1 - (distanceFromEnd / crossfadeLength));
        return { fadeIn, fadeOut };
    }

    _readBuffer(deck, position) {
        if (deck.recordedLength === 0) return 0;
        const wrappedPos = ((position % deck.recordedLength) + deck.recordedLength) % deck.recordedLength;
        const idx0 = Math.floor(wrappedPos);
        const idx1 = (idx0 + 1) % deck.recordedLength;
        const frac = wrappedPos - idx0;
        return deck.buffer[idx0] * (1 - frac) + deck.buffer[idx1] * frac;
    }

    _processDeck(deck, deckId, input, outputIndex, tapeEmulationAmount) {
        if (deck.recordedLength === 0 && !deck.isRecording) {
            return deck.monitorMode === 'enabled' ? input : 0;
        }
        const playbackRate = this._getPlaybackRate(deckId);
        const loopStart = this._getLoopStart(deckId);
        const loopEnd = this._getLoopEnd(deckId);
        const loopLength = loopEnd - loopStart;
        const crossfadeLength = this._getCrossfadeLength();
        const dubLevel = deckId === 'A' ? this.params.dubLevelA : this.params.dubLevelB;
        const inputLevel = deckId === 'A' ? this.params.inputLevelA : this.params.inputLevelB;
        const outputLevel = deckId === 'A' ? this.params.outputLevelA : this.params.outputLevelB;

        let processedInput = input * inputLevel * 2;
        if (tapeEmulationAmount > 0) {
            processedInput = this._applyTapeSaturation(processedInput, this.params.saturation * tapeEmulationAmount);
        }

        if (deck.isRecording && deck.recordWriteHead < SAMPLES_PER_DECK) {
            if (deck.isPunchIn) deck.buffer[deck.recordWriteHead] = processedInput;
            else deck.buffer[deck.recordWriteHead] = deck.buffer[deck.recordWriteHead] * dubLevel + processedInput;
            deck.recordWriteHead++;
            if (deck.recordMode === 'oneshot' && deck.recordedLength > 0 && deck.recordWriteHead >= loopEnd) {
                this._stopRecording(deckId);
            }
        }

        let playbackSample = 0;
        const shouldPlay = deck.isPlaying && (deck.playbackMode === 'loop' || deck.oneShotPlaying);

        if (shouldPlay && deck.recordedLength > 0 && loopLength > 0) {
            const wowFlutterMod = this._getWowFlutter(this.params.wowFlutter * tapeEmulationAmount);
            const modulatedRate = playbackRate * (1 + wowFlutterMod);
            const { fadeIn, fadeOut } = this._calculateCrossfadeGain(deck.playheadPosition, loopStart, loopEnd, crossfadeLength);

            let mainSample = this._readBuffer(deck, deck.playheadPosition) * fadeIn;
            if (fadeOut > 0) {
                const crossfadeReadPos = loopStart + (deck.playheadPosition - (loopEnd - crossfadeLength));
                mainSample += this._readBuffer(deck, crossfadeReadPos) * fadeOut;
            }
            playbackSample = mainSample;

            if (this.multiTapEnabled && deck.activeTapCount > 0) {
                for (const tap of deck.taps) {
                    if (!tap.active) continue;
                    playbackSample += this._readBuffer(deck, tap.position) * tap.amplitude;
                    tap.position += tap.speed * (1 + wowFlutterMod);
                    if (tap.speed > 0 && tap.position >= loopEnd) tap.position = loopStart + ((tap.position - loopStart) % loopLength);
                    else if (tap.speed < 0 && tap.position < loopStart) tap.position = loopEnd - ((loopStart - tap.position) % loopLength);
                }
                playbackSample /= Math.sqrt(deck.activeTapCount + 1);
            }

            deck.playheadPosition += modulatedRate;
            if (modulatedRate > 0 && deck.playheadPosition >= loopEnd) {
                if (deck.playbackMode === 'oneshot') { deck.oneShotPlaying = false; deck.playheadPosition = loopStart; }
                else deck.playheadPosition = loopStart + ((deck.playheadPosition - loopStart) % loopLength);
                this.port.postMessage({ type: 'loopEnd', deck: deckId });
            } else if (modulatedRate < 0 && deck.playheadPosition < loopStart) {
                if (deck.playbackMode === 'oneshot') { deck.oneShotPlaying = false; deck.playheadPosition = loopEnd - 1; }
                else deck.playheadPosition = loopEnd - ((loopStart - deck.playheadPosition) % loopLength);
                this.port.postMessage({ type: 'loopEnd', deck: deckId });
            }
        }

        if (tapeEmulationAmount > 0) {
            if (this.params.saturation > 0.01) playbackSample = this._applyTapeSaturation(playbackSample, this.params.saturation * tapeEmulationAmount);
            if (deckId === 'A') {
                const result = this._applyTapeFilter(playbackSample, this.filterStateAL, tapeEmulationAmount * 0.7);
                playbackSample = result.sample; this.filterStateAL = result.state;
            } else {
                const result = this._applyTapeFilter(playbackSample, this.filterStateBL, tapeEmulationAmount * 0.7);
                playbackSample = result.sample; this.filterStateBL = result.state;
            }
        }

        let monitorSample = 0;
        if (deck.monitorMode === 'enabled') monitorSample = processedInput;
        else if (deck.monitorMode === 'armed' && (deck.isArmed || deck.isRecording)) monitorSample = processedInput;

        return (playbackSample + monitorSample) * outputLevel;
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

        this.smoothedMix += (this.params.mix - this.smoothedMix) * 0.001;
        const tapeEmulationAmount = this.params.tapeEmulation;

        for (let i = 0; i < outputL.length; i++) {
            const inL = inputL[i] || 0;
            const inR = inputR[i] || 0;
            const auxXfade = this.params.auxInputXfade;
            let deckAOutput, deckBOutput;

            if (this.linkEnabled) {
                deckAOutput = this._processDeck(this.deckA, 'A', inL, i, tapeEmulationAmount);
                deckBOutput = this._processDeck(this.deckB, 'B', inR, i, tapeEmulationAmount);
            } else {
                deckAOutput = this._processDeck(this.deckA, 'A', inL * (1 - auxXfade) + inR * auxXfade, i, tapeEmulationAmount);
                deckBOutput = this._processDeck(this.deckB, 'B', inL * auxXfade + inR * (1 - auxXfade), i, tapeEmulationAmount);
            }

            const outXfade = this.params.auxOutputXfade;
            const mixedL = deckAOutput * (1 - outXfade) + deckBOutput * outXfade;
            const mixedR = deckAOutput * outXfade + deckBOutput * (1 - outXfade);
            outputL[i] = inL * (1 - this.smoothedMix) + mixedL * this.smoothedMix;
            outputR[i] = inR * (1 - this.smoothedMix) + mixedR * this.smoothedMix;
        }
        return true;
    }
}

registerProcessor('lubadh-processor', LubadhProcessor);
`;

export class LubadhAdapter extends ExternalEffectWrapper {
  constructor(audioContext, slot) {
    super('lubadh', audioContext, slot);

    this.params = {
      speedA: 0.75, startA: 0, lengthA: 1, inputLevelA: 0.5, outputLevelA: 1, dubLevelA: 0.9,
      speedB: 0.75, startB: 0, lengthB: 1, inputLevelB: 0.5, outputLevelB: 1, dubLevelB: 0.9,
      auxInputXfade: 0.5, auxOutputXfade: 0.5,
      tapeEmulation: 0.5, wowFlutter: 0.3, saturation: 0.4, tapeFilter: 0.5,
      crossfadeDuration: 0.5, mix: 1, link: 0
    };
  }

  async initialize() {
    const blob = new Blob([LUBADH_PROCESSOR_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      await this.ctx.audioWorklet.addModule(url);
    } catch (e) {
      if (!e.message.includes('already been added')) {
        console.warn('LubadhAdapter: Worklet registration note:', e.message);
      }
    }

    URL.revokeObjectURL(url);

    this.workletNode = new AudioWorkletNode(this.ctx, 'lubadh-processor', {
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

    this.workletNode.port.onmessage = (e) => {
      if (e.data.type === 'loopEnd' && this.onLoopEnd) {
        this.onLoopEnd(e.data.deck);
      } else if (e.data.type === 'recordingStopped' && this.onRecordingStopped) {
        this.onRecordingStopped(e.data);
      }
    };

    return this;
  }

  get input() { return this._inputGain; }
  get output() { return this._outputGain; }

  setParam(name, value) {
    if (!(name in this.params)) {
      console.warn(`LubadhAdapter: Unknown parameter "${name}"`);
      return;
    }
    this.params[name] = value;

    if (name === 'link') {
      this.workletNode?.port.postMessage({ type: 'setLink', enabled: value > 0.5 });
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

  // === SPECIAL CONTROLS ===
  startRecording(deck = 'A') { this.workletNode?.port.postMessage({ type: 'startRecording', deck }); }
  stopRecording(deck = 'A') { this.workletNode?.port.postMessage({ type: 'stopRecording', deck }); }
  punchIn(deck = 'A') { this.workletNode?.port.postMessage({ type: 'punchIn', deck }); }
  erase(deck = 'A') { this.workletNode?.port.postMessage({ type: 'erase', deck }); }
  retrigger(deck = 'A') { this.workletNode?.port.postMessage({ type: 'retrigger', deck }); }
  addTap(deck = 'A') { this.workletNode?.port.postMessage({ type: 'addTap', deck }); }
  removeTap(deck = 'A') { this.workletNode?.port.postMessage({ type: 'removeTap', deck }); }
  clearTaps(deck = 'A') { this.workletNode?.port.postMessage({ type: 'clearTaps', deck }); }
  setMultiTap(enabled) { this.workletNode?.port.postMessage({ type: 'setMultiTap', enabled }); }

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

registerExternalEffect('lubadh', LubadhAdapter);
