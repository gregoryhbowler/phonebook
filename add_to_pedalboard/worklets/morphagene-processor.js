// MORPHAGENE PROCESSOR - AudioWorkletProcessor
// Make Noise / Soundhack Morphagene Emulation
// Next-generation Tape and Microsound music module
// 48kHz, 32-bit depth, 2.9 minute Reels, up to 300 Splices
// Granular synthesis via Genes with Morph (up to 4 overlapping voices)

// Buffer configuration: 2.9 minutes at 48kHz stereo
const MAX_SAMPLE_RATE = 48000;
const REEL_DURATION = 174; // 2.9 minutes in seconds
const SAMPLES_PER_REEL = MAX_SAMPLE_RATE * REEL_DURATION;
const MAX_SPLICES = 300;

// Gene timing
const MIN_GENE_SIZE_MS = 1;      // 1ms minimum (clicks/microsound)
const MAX_GENE_SIZE_MS = 10000;  // 10 seconds when full splice

// Vari-speed range
const VARISPEED_OCTAVES_UP = 1;    // +12 semitones
const VARISPEED_OCTAVES_DOWN = 2.17; // -26 semitones

// Morph voices
const MAX_MORPH_VOICES = 4;

// Dynamic envelope times for click suppression
const ENVELOPE_ATTACK_MS = 2;
const ENVELOPE_RELEASE_MS = 2;

class MorphageneVoice {
    constructor() {
        this.active = false;
        this.position = 0;          // Current playback position in samples
        this.geneStart = 0;         // Gene start position
        this.geneEnd = 0;           // Gene end position
        this.geneLength = 0;        // Gene length in samples
        this.progress = 0;          // 0-1 progress through gene
        this.playbackRate = 1;      // Current playback rate
        this.direction = 1;         // 1 = forward, -1 = reverse
        this.pan = 0.5;             // Stereo pan
        this.pitchRatio = 1;        // Pitch ratio for morph chord
        this.amplitude = 1;         // Voice amplitude
        this.envelopePhase = 0;     // 0=attack, 1=sustain, 2=release
        this.envelopeValue = 0;     // Current envelope value
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

        // === REEL BUFFER (2.9 minutes stereo) ===
        this.reelBufferL = new Float32Array(SAMPLES_PER_REEL);
        this.reelBufferR = new Float32Array(SAMPLES_PER_REEL);
        this.reelLength = 0;        // Amount of reel filled (samples)

        // === SPLICE MARKERS ===
        // Each splice is defined by start position, splices[i] to splices[i+1]
        // splices[0] is always 0 (start of reel)
        this.splices = [0];         // Array of splice marker positions
        this.currentSplice = 0;     // Currently selected splice index
        this.nextSplice = 0;        // Splice to play after current ends (for Organize)

        // === PLAYBACK STATE ===
        this.playheadPosition = 0;  // Main playhead position
        this.isPlaying = true;      // Play gate state

        // === MORPH VOICES ===
        this.voices = [];
        for (let i = 0; i < MAX_MORPH_VOICES; i++) {
            this.voices.push(new MorphageneVoice());
        }
        this.activeVoiceCount = 1;
        this.geneCounter = 0;       // Counter for gene triggering

        // === RECORDING STATE ===
        this.isRecording = false;
        this.recordWriteHead = 0;
        this.recordingStartPos = 0;  // Track where recording started

        // === PARAMETERS ===
        this.params = {
            // Vari-Speed: bipolar -1 to +1 (0 = stopped, negative = reverse)
            varispeed: 0.5,         // 0-1 normalized (0.5 = stopped)

            // Gene-Size: 0 = full splice, 1 = microsound
            geneSize: 0,

            // Slide: 0-1 position within splice for gene start
            slide: 0,

            // Morph: 0-1 gene overlap/layering
            morph: 0.3,             // ~8:30 position = seamless loop (no gap)

            // Organize: 0-1 splice selection
            organize: 0,

            // S.O.S: 0 = input only, 1 = playback only
            sos: 1,

            // Mix: dry/wet (for insert processing)
            mix: 1
        };

        // === STATE FLAGS ===
        this.freezeActive = false;

        // === CLOCK SYNC STATE ===
        this.clockBPM = 120;
        this.externalClockActive = false;
        this.lastClockTime = 0;
        this.clockPeriodSamples = 0;
        this.timeStretchMode = false;   // True when morph > ~11:00 with clock
        this.geneShiftMode = false;     // True when morph < ~11:00 with clock

        // === MORPH CHORD RATIOS (from hardware defaults) ===
        // At extreme morph, voices get pitch shifted
        this.morphChordRatios = [1, 2, 3, 4]; // Unison, +1oct, +1oct+5th, +2oct

        // === SMOOTHING ===
        this.smoothedSOS = 1;
        this.smoothedMix = 1;
        this.smoothedVarispeed = 0;

        // === ENVELOPE SETTINGS ===
        this.envelopeAttackSamples = Math.floor(ENVELOPE_ATTACK_MS * this.sampleRate / 1000);
        this.envelopeReleaseSamples = Math.floor(ENVELOPE_RELEASE_MS * this.sampleRate / 1000);

        // === END OF SPLICE/GENE OUTPUT ===
        this.eosgTrigger = false;
        this.eosgCounter = 0;

        // === CV OUTPUT (envelope follower) ===
        this.cvOutputValue = 0;
        this.cvEnvelopeAttack = 0.01;
        this.cvEnvelopeRelease = 0.001;

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

            case 'setMorphChordRatios':
                if (Array.isArray(data.ratios) && data.ratios.length === 4) {
                    this.morphChordRatios = data.ratios;
                }
                break;
        }
    }

    _setParam(name, value) {
        if (name in this.params) {
            this.params[name] = value;

            // Update organize target splice
            if (name === 'organize') {
                this._updateOrganize();
            }
        }
    }

    // === BUFFER LOADING ===

    _loadBuffer(bufferL, bufferR, splices) {
        // Load audio buffer
        const length = Math.min(bufferL.length, SAMPLES_PER_REEL);
        this.reelBufferL.set(bufferL.slice(0, length));
        this.reelBufferR.set(bufferR.slice(0, length));
        this.reelLength = length;

        // Load splice markers
        if (splices && splices.length > 0) {
            this.splices = [0, ...splices.filter(s => s > 0 && s < length)];
            this.splices.sort((a, b) => a - b);
        } else {
            this.splices = [0];
        }

        this.currentSplice = 0;
        this.nextSplice = 0;
        this.playheadPosition = 0;

        // Reset all voices
        for (const voice of this.voices) {
            voice.reset();
        }
    }

    // === RECORDING ===

    _startRecording(newSplice = false) {
        if (newSplice) {
            // Record into new splice at end of reel
            this.recordWriteHead = this.reelLength;
            this.recordingStartPos = this.reelLength;  // Track start position
            // Create splice marker at current record position
            if (this.reelLength > 0 && !this.splices.includes(this.reelLength)) {
                this.splices.push(this.reelLength);
            }
        } else {
            // Record into current splice (Time Lag Accumulation)
            const spliceStart = this._getSpliceStart(this.currentSplice);
            this.recordWriteHead = spliceStart;
            this.recordingStartPos = spliceStart;  // Track start position
        }
        this.isRecording = true;

        console.log('[Morphagene] Recording started:', {
            newSplice,
            recordWriteHead: this.recordWriteHead,
            recordingStartPos: this.recordingStartPos,
            reelLength: this.reelLength,
            splices: this.splices.slice()
        });
    }

    _stopRecording() {
        this.isRecording = false;

        // Calculate what was recorded
        const recordingStartPos = this.recordingStartPos; // Where recording began (tracked at start)
        const recordingEndPos = this.recordWriteHead;
        const recordedLength = recordingEndPos - recordingStartPos;

        // Update reel length if we recorded past it
        if (this.recordWriteHead > this.reelLength) {
            this.reelLength = this.recordWriteHead;
        }

        // CRITICAL: Set playhead to the start of recorded content
        // This ensures playback will play what was just recorded
        if (recordedLength > 0) {
            // Find the splice that contains the recording start position
            let recordingSpliceIndex = 0;

            // The recording starts either at position 0 (first recording) or at a splice marker
            // Find the splice index for recordingStartPos
            for (let i = this.splices.length - 1; i >= 0; i--) {
                if (this.splices[i] <= recordingStartPos) {
                    recordingSpliceIndex = i;
                    break;
                }
            }

            // Update current splice to the one containing the recording
            this.currentSplice = recordingSpliceIndex;
            this.nextSplice = recordingSpliceIndex;

            // Set playhead to start of the recording (not just splice start)
            // For initial recordings, this is position 0
            this.playheadPosition = recordingStartPos;

            // Reset all voices to start fresh with recorded content
            for (const voice of this.voices) {
                voice.reset();
            }

            // Reset gene counter to trigger immediate playback
            this.geneCounter = 999999;

            // IMPORTANT: If varispeed is at stopped position (0.5), auto-start playback at 1x forward
            // This ensures the user can hear what they just recorded
            if (Math.abs(this.params.varispeed - 0.5) < 0.05) {
                this.params.varispeed = 0.75; // Forward 1x
                this.smoothedVarispeed = 0.5; // Will smoothly accelerate
            }

            console.log('[Morphagene] Recording stopped:', {
                recordingStartPos,
                recordingEndPos,
                recordedLength,
                reelLength: this.reelLength,
                currentSplice: this.currentSplice,
                splices: this.splices,
                playheadPosition: this.playheadPosition
            });
        }

        // Notify main thread
        this.port.postMessage({
            type: 'recordingStopped',
            reelLength: this.reelLength,
            spliceCount: this.splices.length,
            currentSplice: this.currentSplice,
            playheadPosition: this.playheadPosition,
            varispeed: this.params.varispeed  // In case we auto-started playback
        });
    }

    // === SPLICE MANAGEMENT ===

    _createSpliceMarker() {
        // Create splice at current playhead position
        const pos = Math.floor(this.playheadPosition);
        if (pos > 0 && pos < this.reelLength && !this.splices.includes(pos)) {
            this.splices.push(pos);
            this.splices.sort((a, b) => a - b);

            if (this.splices.length > MAX_SPLICES + 1) {
                // Remove oldest splice (not the first one at 0)
                this.splices.splice(1, 1);
            }
        }
    }

    _deleteSpliceMarker() {
        // Delete next splice marker (merge current with next)
        if (this.splices.length > 1 && this.currentSplice < this.splices.length - 1) {
            this.splices.splice(this.currentSplice + 1, 1);
        }
    }

    _deleteSpliceAudio() {
        // Delete current splice audio
        const start = this._getSpliceStart(this.currentSplice);
        const end = this._getSpliceEnd(this.currentSplice);
        const spliceLength = end - start;

        if (spliceLength > 0 && end <= this.reelLength) {
            // Shift all audio after this splice back
            const remaining = this.reelLength - end;
            if (remaining > 0) {
                this.reelBufferL.copyWithin(start, end, this.reelLength);
                this.reelBufferR.copyWithin(start, end, this.reelLength);
            }

            // Update reel length
            this.reelLength -= spliceLength;

            // Update all splice markers after this one
            for (let i = this.currentSplice + 1; i < this.splices.length; i++) {
                this.splices[i] -= spliceLength;
            }

            // Remove the splice marker
            if (this.currentSplice > 0) {
                this.splices.splice(this.currentSplice, 1);
                this.currentSplice = Math.max(0, this.currentSplice - 1);
            }
        }
    }

    _deleteAllSpliceMarkers() {
        // Keep only the start marker
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

        for (const voice of this.voices) {
            voice.reset();
        }
    }

    _shiftSplice() {
        // Increment to next splice
        if (this.splices.length > 1) {
            this.nextSplice = (this.currentSplice + 1) % this.splices.length;
        }
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

    // === ORGANIZE ===

    _updateOrganize() {
        // Map organize (0-1) to splice index
        const spliceCount = this.splices.length;
        if (spliceCount <= 1) {
            this.nextSplice = 0;
            return;
        }

        // Organize full CW = last splice
        const targetIndex = Math.floor(this.params.organize * spliceCount);
        this.nextSplice = Math.min(targetIndex, spliceCount - 1);
    }

    // === CLOCK HANDLING ===

    _updateClockPeriod() {
        // Calculate samples per beat
        this.clockPeriodSamples = Math.floor((60 / this.clockBPM) * this.sampleRate);
    }

    _handleClockPulse() {
        const morph = this.params.morph;

        // Determine mode based on morph setting
        // Morph < ~0.37 (11:00) = Gene Shift mode
        // Morph > ~0.37 (11:00) = Time Stretch mode
        if (morph < 0.37) {
            this._geneShift();
        } else {
            this._timeStretchPulse();
        }
    }

    _geneShift() {
        // Shift to next gene chronologically
        const spliceStart = this._getSpliceStart(this.currentSplice);
        const spliceLength = this._getSpliceLength(this.currentSplice);
        const geneLength = this._getGeneLengthSamples();

        // Advance position by one gene
        this.playheadPosition += geneLength;

        // Wrap within splice
        if (this.playheadPosition >= spliceStart + spliceLength) {
            this.playheadPosition = spliceStart + ((this.playheadPosition - spliceStart) % spliceLength);
        }
    }

    _timeStretchPulse() {
        // Time stretch: advance through genes at clock rate
        // This allows pitch to be changed without affecting speed
        const spliceStart = this._getSpliceStart(this.currentSplice);
        const spliceLength = this._getSpliceLength(this.currentSplice);
        const geneLength = this._getGeneLengthSamples();

        // Similar to gene shift but with overlap handling
        this.playheadPosition += geneLength;

        if (this.playheadPosition >= spliceStart + spliceLength) {
            this.playheadPosition = spliceStart;
        }
    }

    // === VARI-SPEED ===
    // Hardware mapping (Make Noise Morphagene):
    // - 12:00 (center, 0.5) = stopped (deadband)
    // - 2:30 position (0.75) = 1x forward (original speed)
    // - 9:30 position (0.25) = 1x reverse
    // - Full CW (1.0) = +12 semitones forward (~2x)
    // - Full CCW (0.0) = -26 semitones reverse (~0.22x reverse, very slow)

    _getPlaybackRate() {
        const normalized = this.params.varispeed;

        // Dead zone at center = stopped
        if (Math.abs(normalized - 0.5) < 0.02) {
            return 0;
        }

        if (normalized > 0.5) {
            // FORWARD: 0.5 to 1.0
            // 0.5 = stopped, 0.75 = 1x, 1.0 = 2x (+12 semitones)
            const forwardAmount = (normalized - 0.5) * 2; // 0 to 1

            if (forwardAmount < 0.5) {
                // 0.5 to 0.75 (stopped to 1x): linear acceleration
                // forwardAmount 0 to 0.5 maps to rate 0 to 1
                return forwardAmount * 2; // 0 to 1
            } else {
                // 0.75 to 1.0 (1x to 2x): exponential +12 semitones
                // forwardAmount 0.5 to 1 maps to rate 1 to 2
                const t = (forwardAmount - 0.5) * 2; // 0 to 1
                return Math.pow(2, t); // 1 to 2
            }
        } else {
            // REVERSE: 0.0 to 0.5
            // 0.5 = stopped, 0.25 = -1x, 0.0 = -0.22x (-26 semitones, very slow)
            const reverseAmount = (0.5 - normalized) * 2; // 0 to 1

            if (reverseAmount < 0.5) {
                // 0.5 to 0.25 (stopped to -1x): linear acceleration
                // reverseAmount 0 to 0.5 maps to rate 0 to -1
                return -(reverseAmount * 2); // 0 to -1
            } else {
                // 0.25 to 0.0 (-1x to slow): exponential slow down
                // reverseAmount 0.5 to 1 maps to rate -1 to -0.22
                const t = (reverseAmount - 0.5) * 2; // 0 to 1
                // Map: 0=-1x, 1=-26 semitones = rate of 2^(-26/12) = ~0.22
                const semitones = -t * 26; // 0 to -26
                return -Math.pow(2, semitones / 12); // -1 to -0.22
            }
        }
    }

    // === GENE SIZE ===

    _getGeneLengthSamples() {
        const spliceLength = this._getSpliceLength(this.currentSplice);
        if (spliceLength <= 0) return this.sampleRate * 0.01; // 10ms fallback

        // Gene size 0 = full splice, 1 = microsound
        const geneSize = this.params.geneSize;

        if (geneSize < 0.01) {
            return spliceLength; // Full splice
        }

        // Logarithmic mapping from full splice down to 1ms
        const minSamples = Math.floor(MIN_GENE_SIZE_MS * this.sampleRate / 1000);
        const maxSamples = spliceLength;

        const logMin = Math.log(minSamples);
        const logMax = Math.log(maxSamples);

        // Invert: higher geneSize = smaller genes
        const logValue = logMax - geneSize * (logMax - logMin);
        return Math.floor(Math.exp(logValue));
    }

    // === MORPH ===

    _getMorphSettings() {
        const morph = this.params.morph;

        // Morph regions:
        // 0-0.3 (7:00-8:30): Gaps between genes (pointillist)
        // ~0.3 (8:30): Seamless 1/1 loop
        // 0.3-0.5 (8:30-12:00): 2 gene overlap
        // 0.5-0.55 (12:00-1:00): 3 gene overlap with panning
        // 0.55-1 (1:00-5:00): 4 gene overlap with panning + pitch randomization

        let voiceCount = 1;
        let gapRatio = 0;
        let overlapRatio = 0;
        let enablePanning = false;
        let enablePitchUp = false;

        if (morph < 0.3) {
            // Gap mode: silence between genes
            voiceCount = 1;
            gapRatio = 0.3 - morph; // More gap at lower values
            overlapRatio = 0;
        } else if (morph < 0.35) {
            // Seamless zone
            voiceCount = 1;
            gapRatio = 0;
            overlapRatio = 0;
        } else if (morph < 0.5) {
            // 2 voice overlap
            voiceCount = 2;
            overlapRatio = (morph - 0.35) / 0.15; // 0-1 within this range
        } else if (morph < 0.55) {
            // 3 voice overlap with panning
            voiceCount = 3;
            overlapRatio = 1;
            enablePanning = true;
        } else {
            // 4 voice overlap with panning and pitch
            voiceCount = 4;
            overlapRatio = 1;
            enablePanning = true;
            enablePitchUp = true;
        }

        return {
            voiceCount,
            gapRatio,
            overlapRatio,
            enablePanning,
            enablePitchUp
        };
    }

    // === VOICE MANAGEMENT ===

    _spawnVoice(voiceIndex, geneStart, geneLength, playbackRate, morphSettings) {
        const voice = this.voices[voiceIndex];

        // Don't spawn voices with zero or near-zero playback rate
        if (Math.abs(playbackRate) < 0.01) {
            return;
        }

        voice.active = true;
        voice.geneStart = geneStart;
        voice.geneLength = geneLength;
        voice.geneEnd = geneStart + geneLength;
        voice.direction = playbackRate >= 0 ? 1 : -1;
        voice.playbackRate = Math.abs(playbackRate);

        // For reverse playback, start at end of gene
        if (voice.direction < 0) {
            voice.position = voice.geneEnd - 1;
            voice.progress = 1;
        } else {
            voice.position = geneStart;
            voice.progress = 0;
        }

        voice.envelopePhase = 0;
        voice.envelopeValue = 0;
        voice.amplitude = 1 / Math.sqrt(morphSettings.voiceCount); // Equal power

        // Pitch for morph chord voices
        if (morphSettings.enablePitchUp && voiceIndex > 0) {
            voice.pitchRatio = this.morphChordRatios[voiceIndex];
        } else {
            voice.pitchRatio = 1;
        }

        // Panning for multi-voice morph
        if (morphSettings.enablePanning && morphSettings.voiceCount > 1) {
            // Spread voices across stereo field
            voice.pan = voiceIndex / (morphSettings.voiceCount - 1);
        } else {
            voice.pan = 0.5;
        }
    }

    _processVoice(voice, outputL, outputR, sampleIndex) {
        if (!voice.active) return;

        // Process envelope
        switch (voice.envelopePhase) {
            case 0: // Attack
                voice.envelopeValue += 1 / this.envelopeAttackSamples;
                if (voice.envelopeValue >= 1) {
                    voice.envelopeValue = 1;
                    voice.envelopePhase = 1;
                }
                break;
            case 1: // Sustain
                // Check if approaching end of gene
                const remainingProgress = 1 - voice.progress;
                const releaseProgress = this.envelopeReleaseSamples / voice.geneLength;
                if (remainingProgress <= releaseProgress) {
                    voice.envelopePhase = 2;
                }
                break;
            case 2: // Release
                voice.envelopeValue -= 1 / this.envelopeReleaseSamples;
                if (voice.envelopeValue <= 0) {
                    voice.envelopeValue = 0;
                    voice.active = false;
                    return;
                }
                break;
        }

        // Read from buffer with interpolation
        const readPos = voice.position;
        const readPosInt = Math.floor(readPos);
        const frac = readPos - readPosInt;

        // Wrap read position within reel
        const idx0 = ((readPosInt % this.reelLength) + this.reelLength) % this.reelLength;
        const idx1 = ((readPosInt + 1) % this.reelLength + this.reelLength) % this.reelLength;

        // Linear interpolation
        const sampleL = this.reelBufferL[idx0] * (1 - frac) + this.reelBufferL[idx1] * frac;
        const sampleR = this.reelBufferR[idx0] * (1 - frac) + this.reelBufferR[idx1] * frac;

        // Apply envelope and amplitude
        const amp = voice.envelopeValue * voice.amplitude;

        // Apply panning (constant power)
        const panAngle = voice.pan * Math.PI * 0.5;
        const panL = Math.cos(panAngle);
        const panR = Math.sin(panAngle);

        outputL[sampleIndex] += sampleL * amp * panL;
        outputR[sampleIndex] += sampleR * amp * panR;

        // Advance position
        const effectiveRate = voice.playbackRate * voice.pitchRatio * voice.direction;
        voice.position += effectiveRate;

        // Calculate progress (0 to 1) regardless of direction
        if (voice.direction > 0) {
            voice.progress = (voice.position - voice.geneStart) / voice.geneLength;
        } else {
            // For reverse, progress goes from 1 to 0
            voice.progress = (voice.geneEnd - voice.position) / voice.geneLength;
        }

        // Check for gene end
        if (voice.direction > 0 && voice.position >= voice.geneEnd) {
            voice.active = false;
        } else if (voice.direction < 0 && voice.position <= voice.geneStart) {
            voice.active = false;
        }
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

        // Get playback parameters
        const playbackRate = this._getPlaybackRate();
        const geneLength = this._getGeneLengthSamples();
        const morphSettings = this._getMorphSettings();
        const spliceStart = this._getSpliceStart(this.currentSplice);
        const spliceEnd = this._getSpliceEnd(this.currentSplice);
        const spliceLength = spliceEnd - spliceStart;

        // Calculate gene spawn interval based on morph overlap
        let geneSpawnInterval = geneLength;
        if (morphSettings.voiceCount > 1 && morphSettings.overlapRatio > 0) {
            geneSpawnInterval = Math.floor(geneLength / morphSettings.voiceCount);
        }

        // Smooth parameters
        this.smoothedSOS += (this.params.sos - this.smoothedSOS) * 0.001;
        this.smoothedMix += (this.params.mix - this.smoothedMix) * 0.001;
        // Use faster smoothing for varispeed to make direction changes more responsive
        // But also handle sign changes specially to avoid glitches
        const varispeedDiff = playbackRate - this.smoothedVarispeed;
        // Faster smoothing when changing direction (crossing zero) or far from target
        const smoothingFactor = Math.abs(varispeedDiff) > 0.5 ? 0.05 : 0.02;
        this.smoothedVarispeed += varispeedDiff * smoothingFactor;

        for (let i = 0; i < outputL.length; i++) {
            const inL = inputL[i] || 0;
            const inR = inputR[i] || 0;

            // === RECORDING ===
            if (this.isRecording && !this.freezeActive) {
                // Calculate what to record based on S.O.S
                // S.O.S CCW = input only, CW = playback only
                // We need current playback output for this
                // For now, record mix of input and playback
                if (this.recordWriteHead < SAMPLES_PER_REEL) {
                    // Simple recording: just input for initial recording
                    // TLA would mix in playback
                    this.reelBufferL[this.recordWriteHead] = inL;
                    this.reelBufferR[this.recordWriteHead] = inR;
                    this.recordWriteHead++;

                    if (this.recordWriteHead >= SAMPLES_PER_REEL) {
                        this._stopRecording();
                    }
                }
            }

            // === PLAYBACK ===
            let playbackL = 0;
            let playbackR = 0;

            if (this.reelLength > 0 && this.isPlaying && spliceLength > 0) {
                // Calculate gene start position based on slide
                const slideOffset = Math.floor(this.params.slide * spliceLength);
                const geneStart = spliceStart + ((Math.floor(this.playheadPosition) - spliceStart + slideOffset) % spliceLength);

                // Check if we need to spawn new gene(s)
                this.geneCounter++;

                // Use target playback rate for spawning (not smoothed) to avoid issues during transitions
                // But only spawn if we're actually supposed to be playing (not in stopped zone)
                const targetRate = playbackRate; // From _getPlaybackRate(), based on params.varispeed

                if ((this.geneCounter >= geneSpawnInterval || !this.voices[0].active) && Math.abs(targetRate) > 0.01) {
                    this.geneCounter = 0;

                    // Spawn voices based on morph settings
                    for (let v = 0; v < morphSettings.voiceCount; v++) {
                        // Stagger voice start positions for overlap
                        const voiceOffset = Math.floor(v * geneLength / morphSettings.voiceCount);
                        const voiceStart = spliceStart + ((geneStart - spliceStart + voiceOffset) % spliceLength);

                        // Only spawn if voice is inactive or we're starting fresh
                        if (!this.voices[v].active) {
                            // Use target rate for voice spawning so direction is correct immediately
                            this._spawnVoice(v, voiceStart, geneLength, targetRate, morphSettings);
                        }
                    }

                    // EOSG trigger
                    this.eosgTrigger = true;
                    this.eosgCounter = Math.floor(this.sampleRate * 0.01); // 10ms gate
                }

                // Process all active voices
                for (const voice of this.voices) {
                    this._processVoice(voice, outputL, outputR, i);
                }

                playbackL = outputL[i];
                playbackR = outputR[i];

                // Reset output for final mix
                outputL[i] = 0;
                outputR[i] = 0;

                // Advance main playhead (for non-clock-synced operation)
                if (!this.externalClockActive) {
                    this.playheadPosition += this.smoothedVarispeed;

                    // Handle wrapping and splice changes
                    if (this.smoothedVarispeed > 0) {
                        if (this.playheadPosition >= spliceEnd) {
                            // End of splice - check for organize change
                            if (this.nextSplice !== this.currentSplice) {
                                this.currentSplice = this.nextSplice;
                            }
                            this.playheadPosition = this._getSpliceStart(this.currentSplice);
                        }
                    } else if (this.smoothedVarispeed < 0) {
                        if (this.playheadPosition < spliceStart) {
                            if (this.nextSplice !== this.currentSplice) {
                                this.currentSplice = this.nextSplice;
                            }
                            this.playheadPosition = this._getSpliceEnd(this.currentSplice) - 1;
                        }
                    }
                }

                // Handle gap mode (morph < 0.3)
                if (morphSettings.gapRatio > 0 && this.geneCounter < geneSpawnInterval * morphSettings.gapRatio) {
                    // Silence during gap
                    playbackL = 0;
                    playbackR = 0;
                }
            }

            // === S.O.S MIX ===
            // S.O.S 0 = input only, 1 = playback only
            const sosL = inL * (1 - this.smoothedSOS) + playbackL * this.smoothedSOS;
            const sosR = inR * (1 - this.smoothedSOS) + playbackR * this.smoothedSOS;

            // === DRY/WET MIX ===
            outputL[i] = inL * (1 - this.smoothedMix) + sosL * this.smoothedMix;
            outputR[i] = inR * (1 - this.smoothedMix) + sosR * this.smoothedMix;

            // === CV OUTPUT (envelope follower) ===
            const outputLevel = Math.max(Math.abs(outputL[i]), Math.abs(outputR[i]));
            if (outputLevel > this.cvOutputValue) {
                this.cvOutputValue += (outputLevel - this.cvOutputValue) * this.cvEnvelopeAttack;
            } else {
                this.cvOutputValue += (outputLevel - this.cvOutputValue) * this.cvEnvelopeRelease;
            }

            // === EOSG GATE ===
            if (this.eosgCounter > 0) {
                this.eosgCounter--;
            }
        }

        // Send EOSG trigger message
        if (this.eosgTrigger) {
            this.port.postMessage({ type: 'eosg' });
            this.eosgTrigger = false;
        }

        return true;
    }
}

registerProcessor('morphagene-processor', MorphageneProcessor);
