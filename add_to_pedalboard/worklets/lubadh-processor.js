// LUBADH PROCESSOR - AudioWorkletProcessor
// Instruō Lúbadh Dual Looper Emulation
// 48kHz, 32-bit depth, 10 minutes per deck
// Varispeed ±4x, overdub with feedback, tape emulation

// Buffer configuration: 10 minutes at 48kHz stereo per deck
const MAX_SAMPLE_RATE = 48000;
const REEL_DURATION = 600; // 10 minutes in seconds
const SAMPLES_PER_DECK = MAX_SAMPLE_RATE * REEL_DURATION;

// Crossfade configuration
const MAX_CROSSFADE_MS = 250; // 250ms max crossfade as per manual

// Multi-tap configuration
const MAX_TAPS = 4;

// Tape emulation constants
const WOW_FLUTTER_RATE_HZ = 0.5;  // Slow modulation
const WOW_FLUTTER_DEPTH = 0.002;  // Max pitch deviation
const TAPE_FILTER_FREQ = 8000;    // Base lowpass frequency

// Speed range: ±4x (±2 octaves)
const MAX_SPEED_MULTIPLIER = 4;

// Recording modes
const RECORD_MODE = { LOOP: 'loop', ONE_SHOT: 'oneshot' };
const PLAYBACK_MODE = { LOOP: 'loop', ONE_SHOT: 'oneshot' };
const MONITOR_MODE = { ENABLED: 'enabled', ARMED: 'armed', DISABLED: 'disabled' };
const TIME_MODE = { CLOCK_DIV: 'clock', DUB_LEVEL: 'dub', USER_PARAM: 'user' };

// Playhead tap for multi-tap delay
class PlayheadTap {
    constructor() {
        this.active = false;
        this.position = 0;
        this.speed = 1;
        this.amplitude = 1;
        this.pan = 0.5;
        this.fadeIn = 0;
        this.fadeOut = 0;
    }

    reset() {
        this.active = false;
        this.position = 0;
        this.fadeIn = 0;
        this.fadeOut = 0;
    }
}

// Single deck state
class DeckState {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;

        // Audio buffer
        this.buffer = new Float32Array(SAMPLES_PER_DECK);
        this.recordedLength = 0;

        // Playback state
        this.playheadPosition = 0;
        this.isPlaying = true;

        // Recording state
        this.isRecording = false;
        this.isPunchIn = false;
        this.recordWriteHead = 0;

        // Modes
        this.recordMode = RECORD_MODE.LOOP;
        this.playbackMode = PLAYBACK_MODE.LOOP;
        this.monitorMode = MONITOR_MODE.ENABLED;
        this.timeMode = TIME_MODE.CLOCK_DIV;
        this.isArmed = false;

        // Multi-tap playheads
        this.taps = [];
        for (let i = 0; i < MAX_TAPS; i++) {
            this.taps.push(new PlayheadTap());
        }
        this.activeTapCount = 0;

        // Clock
        this.clockDivision = 1;
        this.clockCounter = 0;

        // Quantization
        this.quantization = 0;

        // Crossfade state
        this.crossfadePosition = 0;
        this.crossfadeActive = false;
        this.crossfadeLength = 0;

        // One-shot state
        this.oneShotPlaying = false;
    }

    reset() {
        this.buffer.fill(0);
        this.recordedLength = 0;
        this.playheadPosition = 0;
        this.isRecording = false;
        this.recordWriteHead = 0;
        for (const tap of this.taps) {
            tap.reset();
        }
        this.activeTapCount = 0;
    }
}

class LubadhProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        this.sampleRate = options.processorOptions?.sampleRate || 48000;

        // === DUAL DECK BUFFERS ===
        this.deckA = new DeckState(this.sampleRate);
        this.deckB = new DeckState(this.sampleRate);

        // === PARAMETERS ===
        this.params = {
            // Deck A
            speedA: 0.75,
            startA: 0,
            lengthA: 1,
            inputLevelA: 0.5,
            outputLevelA: 1,
            dubLevelA: 0.9,

            // Deck B
            speedB: 0.75,
            startB: 0,
            lengthB: 1,
            inputLevelB: 0.5,
            outputLevelB: 1,
            dubLevelB: 0.9,

            // Aux crossfade
            auxInputXfade: 0.5,
            auxOutputXfade: 0.5,

            // Tape emulation
            tapeEmulation: 0.5,
            wowFlutter: 0.3,
            saturation: 0.4,
            tapeFilter: 0.5,

            // Crossfade
            crossfadeDuration: 0.5,

            // Mix
            mix: 1
        };

        // === LINK MODE ===
        this.linkEnabled = false;

        // === MULTI-TAP MODE ===
        this.multiTapEnabled = false;

        // === CLOCK ===
        this.clockBPM = 120;
        this.externalClockActive = false;
        this.clockPeriodSamples = 0;
        this._updateClockPeriod();

        // === TAPE EMULATION STATE ===
        this.wowPhase = 0;
        this.flutterPhase = 0;

        // Tape filter state (simple one-pole lowpass per deck)
        this.filterStateAL = 0;
        this.filterStateAR = 0;
        this.filterStateBL = 0;
        this.filterStateBR = 0;

        // === SMOOTHING ===
        this.smoothedSpeedA = 0;
        this.smoothedSpeedB = 0;
        this.smoothedMix = 1;

        // === CROSSFADE BUFFER ===
        // For seamless loop transitions
        this.crossfadeSamples = Math.floor(MAX_CROSSFADE_MS * this.sampleRate / 1000);

        // === MESSAGE HANDLING ===
        this.port.onmessage = (e) => this._handleMessage(e.data);
    }

    // === MESSAGE HANDLING ===

    _handleMessage(data) {
        switch (data.type) {
            case 'setParam':
                this._setParam(data.name, data.value);
                break;

            case 'startRecording':
                this._startRecording(data.deck);
                break;

            case 'stopRecording':
                this._stopRecording(data.deck);
                break;

            case 'punchIn':
                this._punchIn(data.deck);
                break;

            case 'erase':
                this._erase(data.deck);
                break;

            case 'retrigger':
                this._retrigger(data.deck);
                break;

            case 'loadBuffer':
                this._loadBuffer(data.deck, data.bufferL, data.bufferR);
                break;

            case 'setLink':
                this.linkEnabled = !!data.enabled;
                break;

            case 'setMultiTap':
                this.multiTapEnabled = !!data.enabled;
                break;

            case 'addTap':
                this._addTap(data.deck);
                break;

            case 'removeTap':
                this._removeTap(data.deck);
                break;

            case 'clearTaps':
                this._clearTaps(data.deck);
                break;

            case 'setBPM':
                this.clockBPM = Math.max(20, Math.min(300, data.bpm));
                this._updateClockPeriod();
                break;

            case 'setExternalClock':
                this.externalClockActive = !!data.enabled;
                break;

            case 'clockPulse':
                this._handleClockPulse();
                break;

            case 'setRecordMode':
                this._getDeck(data.deck).recordMode = data.mode;
                break;

            case 'setPlaybackMode':
                this._getDeck(data.deck).playbackMode = data.mode;
                break;

            case 'setMonitorMode':
                this._getDeck(data.deck).monitorMode = data.mode;
                break;

            case 'setTimeMode':
                this._getDeck(data.deck).timeMode = data.mode;
                break;

            case 'setClockDivision':
                this._getDeck(data.deck).clockDivision = data.division;
                break;

            case 'setQuantization':
                this._getDeck(data.deck).quantization = data.divisions;
                break;

            case 'setDeckState':
                // Bulk state update
                const deck = this._getDeck(data.deck);
                if (data.state) {
                    if (data.state.recordMode) deck.recordMode = data.state.recordMode;
                    if (data.state.playbackMode) deck.playbackMode = data.state.playbackMode;
                    if (data.state.monitorMode) deck.monitorMode = data.state.monitorMode;
                    if (data.state.timeMode) deck.timeMode = data.state.timeMode;
                    if (data.state.clockDivision) deck.clockDivision = data.state.clockDivision;
                    if (data.state.quantization) deck.quantization = data.state.quantization;
                }
                break;
        }
    }

    _getDeck(deckId) {
        return deckId === 'A' ? this.deckA : this.deckB;
    }

    _setParam(name, value) {
        if (name in this.params) {
            this.params[name] = value;
        }
    }

    // === BUFFER LOADING ===

    _loadBuffer(deckId, bufferL, bufferR) {
        const deck = this._getDeck(deckId);

        // For mono deck, average L+R or just use L
        const length = Math.min(bufferL.length, SAMPLES_PER_DECK);

        for (let i = 0; i < length; i++) {
            // Average stereo to mono for internal buffer
            deck.buffer[i] = (bufferL[i] + (bufferR[i] || bufferL[i])) * 0.5;
        }

        deck.recordedLength = length;
        deck.playheadPosition = 0;
        deck.isPlaying = true;

        console.log(`[Lubadh] Loaded buffer to deck ${deckId}:`, {
            length,
            duration: length / this.sampleRate
        });
    }

    // === RECORDING ===

    _startRecording(deckId) {
        const deck = this._getDeck(deckId);

        if (deck.recordedLength === 0) {
            // First recording - start fresh
            deck.recordWriteHead = 0;
        } else {
            // Overdub - start at current playhead
            deck.recordWriteHead = Math.floor(deck.playheadPosition);
        }

        deck.isRecording = true;
        deck.isPunchIn = false;

        console.log(`[Lubadh] Recording started on deck ${deckId}:`, {
            writeHead: deck.recordWriteHead,
            existingLength: deck.recordedLength
        });
    }

    _stopRecording(deckId) {
        const deck = this._getDeck(deckId);

        if (!deck.isRecording) return;

        deck.isRecording = false;

        // If this was the first recording, set the loop length
        if (deck.recordedLength === 0 || deck.recordWriteHead > deck.recordedLength) {
            deck.recordedLength = deck.recordWriteHead;
        }

        // Start playback from beginning
        deck.playheadPosition = 0;
        deck.isPlaying = true;

        console.log(`[Lubadh] Recording stopped on deck ${deckId}:`, {
            recordedLength: deck.recordedLength,
            duration: deck.recordedLength / this.sampleRate
        });

        // Notify main thread
        this.port.postMessage({
            type: 'recordingStopped',
            deck: deckId,
            recordedLength: deck.recordedLength
        });
    }

    _punchIn(deckId) {
        const deck = this._getDeck(deckId);

        // Punch-in is destructive recording (replaces audio)
        deck.recordWriteHead = Math.floor(deck.playheadPosition);
        deck.isRecording = true;
        deck.isPunchIn = true;
    }

    _erase(deckId) {
        const deck = this._getDeck(deckId);
        deck.reset();
    }

    _retrigger(deckId) {
        const deck = this._getDeck(deckId);

        if (deck.recordedLength === 0) return;

        // Calculate loop window
        const loopStart = this._getLoopStart(deckId);

        // Reset playhead to loop start
        deck.playheadPosition = loopStart;

        // For one-shot mode, start playback
        if (deck.playbackMode === PLAYBACK_MODE.ONE_SHOT) {
            deck.oneShotPlaying = true;
        }

        // Reset all taps to start position
        for (const tap of deck.taps) {
            if (tap.active) {
                tap.position = loopStart;
            }
        }
    }

    // === MULTI-TAP ===

    _addTap(deckId) {
        const deck = this._getDeck(deckId);

        // Find inactive tap
        for (const tap of deck.taps) {
            if (!tap.active) {
                tap.active = true;
                tap.position = deck.playheadPosition;
                tap.speed = this._getPlaybackRate(deckId);
                tap.amplitude = 1 / Math.sqrt(deck.activeTapCount + 2); // Equal power
                tap.fadeIn = 0;
                deck.activeTapCount++;

                // Reduce amplitude of other taps for equal power
                for (const t of deck.taps) {
                    if (t.active) {
                        t.amplitude = 1 / Math.sqrt(deck.activeTapCount + 1);
                    }
                }
                break;
            }
        }
    }

    _removeTap(deckId) {
        const deck = this._getDeck(deckId);

        // Remove oldest active tap
        for (let i = deck.taps.length - 1; i >= 0; i--) {
            if (deck.taps[i].active) {
                deck.taps[i].active = false;
                deck.activeTapCount = Math.max(0, deck.activeTapCount - 1);

                // Adjust amplitudes
                for (const t of deck.taps) {
                    if (t.active) {
                        t.amplitude = 1 / Math.sqrt(Math.max(1, deck.activeTapCount + 1));
                    }
                }
                break;
            }
        }
    }

    _clearTaps(deckId) {
        const deck = this._getDeck(deckId);
        for (const tap of deck.taps) {
            tap.reset();
        }
        deck.activeTapCount = 0;
    }

    // === CLOCK ===

    _updateClockPeriod() {
        this.clockPeriodSamples = Math.floor((60 / this.clockBPM) * this.sampleRate);
    }

    _handleClockPulse() {
        // Process clock for both decks
        this._processDeckClock(this.deckA, 'A');
        this._processDeckClock(this.deckB, 'B');
    }

    _processDeckClock(deck, deckId) {
        deck.clockCounter++;

        if (deck.clockDivision > 0 && deck.recordedLength > 0) {
            const triggersPerLoop = deck.clockDivision;
            const samplesPerTrigger = deck.recordedLength / triggersPerLoop;

            if (deck.clockCounter >= samplesPerTrigger) {
                deck.clockCounter = 0;

                this.port.postMessage({
                    type: 'clockPulse',
                    deck: deckId,
                    division: deck.clockDivision
                });
            }
        }
    }

    // === SPEED CALCULATION ===
    // Hardware mapping (Lúbadh):
    // - Center (0.5) = stalled (stopped)
    // - 0.75 = 1x forward
    // - 0.25 = 1x reverse
    // - 1.0 = 4x forward (+2 octaves)
    // - 0.0 = 4x reverse (+2 octaves reversed)

    _getPlaybackRate(deckId) {
        const normalized = deckId === 'A' ? this.params.speedA : this.params.speedB;

        // Dead zone at center = stopped
        if (Math.abs(normalized - 0.5) < 0.02) {
            return 0;
        }

        if (normalized > 0.5) {
            // FORWARD: 0.5 to 1.0 maps to 0x to 4x
            const forwardAmount = (normalized - 0.5) * 2; // 0 to 1

            // Logarithmic mapping for more musical response
            // 0.5->0.75 = 0 to 1x (linear acceleration zone)
            // 0.75->1.0 = 1x to 4x (exponential)
            if (forwardAmount < 0.5) {
                // Linear acceleration from stopped to 1x
                return forwardAmount * 2; // 0 to 1
            } else {
                // Exponential from 1x to 4x
                const t = (forwardAmount - 0.5) * 2; // 0 to 1
                return Math.pow(4, t); // 1 to 4
            }
        } else {
            // REVERSE: 0.0 to 0.5 maps to -4x to 0x
            const reverseAmount = (0.5 - normalized) * 2; // 0 to 1

            if (reverseAmount < 0.5) {
                // Linear acceleration from stopped to -1x
                return -(reverseAmount * 2); // 0 to -1
            } else {
                // Exponential from -1x to -4x
                const t = (reverseAmount - 0.5) * 2; // 0 to 1
                return -Math.pow(4, t); // -1 to -4
            }
        }
    }

    // === LOOP WINDOW CALCULATION ===

    _getLoopStart(deckId) {
        const deck = this._getDeck(deckId);
        const start = deckId === 'A' ? this.params.startA : this.params.startB;

        if (deck.recordedLength === 0) return 0;

        let loopStart = Math.floor(start * deck.recordedLength);

        // Apply quantization if enabled
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

        // Apply quantization if enabled
        if (deck.quantization > 0) {
            const divisionSize = deck.recordedLength / deck.quantization;
            loopLength = Math.max(divisionSize, Math.round(loopLength / divisionSize) * divisionSize);
        }

        // Minimum loop length = 1ms
        const minLength = Math.floor(this.sampleRate / 1000);
        return Math.max(minLength, Math.min(loopLength, maxLength));
    }

    _getLoopEnd(deckId) {
        return this._getLoopStart(deckId) + this._getLoopLength(deckId);
    }

    // === TAPE EMULATION ===

    _applyTapeSaturation(sample, amount) {
        if (amount < 0.01) return sample;

        // Soft clipping using tanh - more aggressive for audible warmth
        const drive = 1 + amount * 6; // 1x to 7x drive (more aggressive)
        const saturated = Math.tanh(sample * drive) / Math.tanh(drive);

        // Add some even harmonics for warmth (subtle 2nd harmonic)
        const harmonic = sample * sample * amount * 0.1;

        // Mix dry/wet with harmonic content
        return sample * (1 - amount) + (saturated + harmonic) * amount;
    }

    _applyTapeFilter(sample, filterState, amount) {
        if (amount < 0.01) return { sample, state: filterState };

        // One-pole lowpass filter
        // Cutoff frequency decreases with amount (more filtering)
        const cutoff = TAPE_FILTER_FREQ * (1 - amount * 0.8); // 8kHz to 1.6kHz
        const rc = 1 / (2 * Math.PI * cutoff);
        const dt = 1 / this.sampleRate;
        const alpha = dt / (rc + dt);

        const filtered = filterState + alpha * (sample - filterState);
        return { sample: filtered, state: filtered };
    }

    _getWowFlutter(amount) {
        if (amount < 0.01) return 0;

        // Wow: slow pitch variation (0.3 Hz for more obvious warble)
        const wowRate = 0.3;
        // More aggressive depth for audible pitch wobble (up to 1.5% pitch deviation)
        const wow = Math.sin(this.wowPhase) * 0.015 * amount;

        // Flutter: faster variation (5-6 Hz)
        const flutterRate = 5.5;
        // Flutter is subtler but adds texture
        const flutter = Math.sin(this.flutterPhase) * 0.004 * amount;

        // Add some randomness for more organic feel
        const noise = (Math.random() - 0.5) * 0.001 * amount;

        // Update phases
        this.wowPhase += (2 * Math.PI * wowRate) / this.sampleRate;
        this.flutterPhase += (2 * Math.PI * flutterRate) / this.sampleRate;

        // Wrap phases
        if (this.wowPhase > 2 * Math.PI) this.wowPhase -= 2 * Math.PI;
        if (this.flutterPhase > 2 * Math.PI) this.flutterPhase -= 2 * Math.PI;

        return wow + flutter + noise;
    }

    // === CROSSFADE ===

    _getCrossfadeLength() {
        return Math.floor(this.params.crossfadeDuration * this.crossfadeSamples);
    }

    _calculateCrossfadeGain(position, loopStart, loopEnd, crossfadeLength) {
        if (crossfadeLength < 1) return { fadeIn: 1, fadeOut: 0 };

        const distanceFromStart = position - loopStart;
        const distanceFromEnd = loopEnd - position;

        let fadeIn = 1;
        let fadeOut = 0;

        // Fade in at loop start
        if (distanceFromStart < crossfadeLength) {
            fadeIn = distanceFromStart / crossfadeLength;
            // Equal power crossfade
            fadeIn = Math.sqrt(fadeIn);
        }

        // Fade out at loop end (this sample will crossfade with loop start)
        if (distanceFromEnd < crossfadeLength) {
            fadeOut = 1 - (distanceFromEnd / crossfadeLength);
            fadeOut = Math.sqrt(fadeOut);
        }

        return { fadeIn, fadeOut };
    }

    // === READ FROM BUFFER WITH INTERPOLATION ===

    _readBuffer(deck, position) {
        if (deck.recordedLength === 0) return 0;

        // Wrap position
        const wrappedPos = ((position % deck.recordedLength) + deck.recordedLength) % deck.recordedLength;

        const idx0 = Math.floor(wrappedPos);
        const idx1 = (idx0 + 1) % deck.recordedLength;
        const frac = wrappedPos - idx0;

        // Linear interpolation
        return deck.buffer[idx0] * (1 - frac) + deck.buffer[idx1] * frac;
    }

    // === PROCESS SINGLE DECK ===

    _processDeck(deck, deckId, input, outputIndex, tapeEmulationAmount) {
        if (deck.recordedLength === 0 && !deck.isRecording) {
            // No recording - pass through based on monitor mode
            if (deck.monitorMode === MONITOR_MODE.ENABLED) {
                return input;
            }
            return 0;
        }

        const playbackRate = this._getPlaybackRate(deckId);
        const loopStart = this._getLoopStart(deckId);
        const loopEnd = this._getLoopEnd(deckId);
        const loopLength = loopEnd - loopStart;
        const crossfadeLength = this._getCrossfadeLength();

        const dubLevel = deckId === 'A' ? this.params.dubLevelA : this.params.dubLevelB;
        const inputLevel = deckId === 'A' ? this.params.inputLevelA : this.params.inputLevelB;
        const outputLevel = deckId === 'A' ? this.params.outputLevelA : this.params.outputLevelB;

        // Input processing with saturation
        let processedInput = input * inputLevel * 2; // inputLevel 0.5 = unity

        if (tapeEmulationAmount > 0) {
            processedInput = this._applyTapeSaturation(processedInput, this.params.saturation * tapeEmulationAmount);
        }

        // === RECORDING ===
        if (deck.isRecording) {
            if (deck.recordWriteHead < SAMPLES_PER_DECK) {
                if (deck.isPunchIn) {
                    // Destructive - replace
                    deck.buffer[deck.recordWriteHead] = processedInput;
                } else {
                    // Overdub - mix with existing at dub level
                    const existing = deck.buffer[deck.recordWriteHead];
                    deck.buffer[deck.recordWriteHead] = existing * dubLevel + processedInput;
                }

                deck.recordWriteHead++;

                // One-shot record mode: stop at loop end
                if (deck.recordMode === RECORD_MODE.ONE_SHOT && deck.recordedLength > 0) {
                    if (deck.recordWriteHead >= loopEnd) {
                        this._stopRecording(deckId);
                    }
                }
            }
        }

        // === PLAYBACK ===
        let playbackSample = 0;

        // Check if we should be playing
        const shouldPlay = deck.isPlaying &&
            (deck.playbackMode === PLAYBACK_MODE.LOOP || deck.oneShotPlaying);

        if (shouldPlay && deck.recordedLength > 0 && loopLength > 0) {
            // Get wow/flutter pitch modulation
            const wowFlutterMod = this._getWowFlutter(this.params.wowFlutter * tapeEmulationAmount);
            const modulatedRate = playbackRate * (1 + wowFlutterMod);

            // Main playhead
            const { fadeIn, fadeOut } = this._calculateCrossfadeGain(
                deck.playheadPosition, loopStart, loopEnd, crossfadeLength
            );

            // Read main sample
            let mainSample = this._readBuffer(deck, deck.playheadPosition);

            // Apply fade in
            mainSample *= fadeIn;

            // If fading out, also read from loop start and crossfade
            if (fadeOut > 0) {
                const crossfadeReadPos = loopStart + (deck.playheadPosition - (loopEnd - crossfadeLength));
                const crossfadeSample = this._readBuffer(deck, crossfadeReadPos);
                mainSample += crossfadeSample * fadeOut;
            }

            playbackSample = mainSample;

            // Process multi-tap playheads
            if (this.multiTapEnabled && deck.activeTapCount > 0) {
                for (const tap of deck.taps) {
                    if (!tap.active) continue;

                    const tapSample = this._readBuffer(deck, tap.position);
                    playbackSample += tapSample * tap.amplitude;

                    // Advance tap position
                    tap.position += tap.speed * (1 + wowFlutterMod);

                    // Wrap tap within loop
                    if (tap.speed > 0 && tap.position >= loopEnd) {
                        tap.position = loopStart + ((tap.position - loopStart) % loopLength);
                    } else if (tap.speed < 0 && tap.position < loopStart) {
                        tap.position = loopEnd - ((loopStart - tap.position) % loopLength);
                    }
                }

                // Normalize for multi-tap
                playbackSample /= Math.sqrt(deck.activeTapCount + 1);
            }

            // Advance main playhead
            deck.playheadPosition += modulatedRate;

            // Handle loop wrapping
            if (modulatedRate > 0) {
                if (deck.playheadPosition >= loopEnd) {
                    if (deck.playbackMode === PLAYBACK_MODE.ONE_SHOT) {
                        deck.oneShotPlaying = false;
                        deck.playheadPosition = loopStart;
                    } else {
                        deck.playheadPosition = loopStart + ((deck.playheadPosition - loopStart) % loopLength);
                    }

                    // Notify loop end
                    this.port.postMessage({ type: 'loopEnd', deck: deckId });
                }
            } else if (modulatedRate < 0) {
                if (deck.playheadPosition < loopStart) {
                    if (deck.playbackMode === PLAYBACK_MODE.ONE_SHOT) {
                        deck.oneShotPlaying = false;
                        deck.playheadPosition = loopEnd - 1;
                    } else {
                        deck.playheadPosition = loopEnd - ((loopStart - deck.playheadPosition) % loopLength);
                    }

                    this.port.postMessage({ type: 'loopEnd', deck: deckId });
                }
            }
        }

        // Apply tape effects to playback
        if (tapeEmulationAmount > 0) {
            // Apply saturation to playback (warmth/compression)
            if (this.params.saturation > 0.01) {
                playbackSample = this._applyTapeSaturation(playbackSample, this.params.saturation * tapeEmulationAmount);
            }

            // Apply tape lowpass filter (high frequency rolloff)
            // Use tapeEmulation amount directly as the filter amount
            if (deckId === 'A') {
                const result = this._applyTapeFilter(playbackSample, this.filterStateAL,
                    tapeEmulationAmount * 0.7); // Scale for musical range
                playbackSample = result.sample;
                this.filterStateAL = result.state;
            } else {
                const result = this._applyTapeFilter(playbackSample, this.filterStateBL,
                    tapeEmulationAmount * 0.7);
                playbackSample = result.sample;
                this.filterStateBL = result.state;
            }
        }

        // === INPUT MONITORING ===
        let monitorSample = 0;

        switch (deck.monitorMode) {
            case MONITOR_MODE.ENABLED:
                monitorSample = processedInput;
                break;
            case MONITOR_MODE.ARMED:
                if (deck.isArmed || deck.isRecording) {
                    monitorSample = processedInput;
                }
                break;
            case MONITOR_MODE.DISABLED:
                // No monitoring
                break;
        }

        // Final mix
        return (playbackSample + monitorSample) * outputLevel;
    }

    // === MAIN PROCESS ===

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!output || !output[0]) return true;

        const outputL = output[0];
        const outputR = output[1] || output[0];

        const hasInput = input && input[0] && input[0].length > 0;
        const inputL = hasInput ? input[0] : new Float32Array(outputL.length);
        const inputR = hasInput ? (input[1] || input[0]) : new Float32Array(outputR.length);

        // Smoothing
        const targetSpeedA = this._getPlaybackRate('A');
        const targetSpeedB = this._getPlaybackRate('B');
        this.smoothedMix += (this.params.mix - this.smoothedMix) * 0.001;

        const tapeEmulationAmount = this.params.tapeEmulation;

        for (let i = 0; i < outputL.length; i++) {
            const inL = inputL[i] || 0;
            const inR = inputR[i] || 0;

            // Aux input crossfade: determine what goes to each deck
            const auxXfade = this.params.auxInputXfade;
            const inputA = inL * (1 - auxXfade) + inR * auxXfade;
            const inputB = inL * auxXfade + inR * (1 - auxXfade);

            // Process each deck
            let deckAOutput, deckBOutput;

            if (this.linkEnabled) {
                // Linked stereo mode: both decks process same content
                // Deck A = Left channel, Deck B = Right channel
                deckAOutput = this._processDeck(this.deckA, 'A', inL, i, tapeEmulationAmount);
                deckBOutput = this._processDeck(this.deckB, 'B', inR, i, tapeEmulationAmount);
            } else {
                // Independent mode
                deckAOutput = this._processDeck(this.deckA, 'A', inputA, i, tapeEmulationAmount);
                deckBOutput = this._processDeck(this.deckB, 'B', inputB, i, tapeEmulationAmount);
            }

            // Aux output crossfade
            const outXfade = this.params.auxOutputXfade;
            const mixedL = deckAOutput * (1 - outXfade) + deckBOutput * outXfade;
            const mixedR = deckAOutput * outXfade + deckBOutput * (1 - outXfade);

            // Final dry/wet mix
            outputL[i] = inL * (1 - this.smoothedMix) + mixedL * this.smoothedMix;
            outputR[i] = inR * (1 - this.smoothedMix) + mixedR * this.smoothedMix;
        }

        // Process clock for both decks
        if (!this.externalClockActive) {
            this._processDeckClock(this.deckA, 'A');
            this._processDeckClock(this.deckB, 'B');
        }

        return true;
    }
}

registerProcessor('lubadh-processor', LubadhProcessor);
