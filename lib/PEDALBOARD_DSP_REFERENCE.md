# Pedalboard DSP Reference Guide

This document maps SuperCollider Pedalboard effects to JavaScript AudioWorklet implementations.
Reference files are in: `patches/FX_to_REFERENCE/pedalboard-master/lib/fx/`

---

## Project Status Tracker

### Phase 1: Foundation - COMPLETE
- [x] Utility classes (DelayLine, Biquad, AllpassFilter, OnePole, LFO, Envelope, MoogLadder, DCBlocker, Compressor, Decimator, EnvelopeFollower)
- [x] EffectChainProcessor AudioWorklet skeleton (`effect-chain-processor.js`)
- [x] Effect chain UI components (`effect-ui.js`, `effect-ui.css`)

### Phase 2: Time-Based Effects - COMPLETE
- [x] Delay (normal, ping-pong, slapback; digital, analog, tape, lo-fi)
- [x] Reverb (with shimmer option)

### Phase 3: Modulation Effects - COMPLETE
- [x] Chorus (4-voice)
- [x] Tremolo (amplitude modulation)
- [x] Flanger (short modulated delay)
- [x] Phaser (4-stage allpass)
- [x] Vibrato (pitch modulation with expression)
- [x] AutoWah (envelope-controlled filter, 3 modes)

### Phase 4: Distortion Effects - COMPLETE
- [x] Overdrive (soft clipping with tone)
- [x] Distortion (hard clipping with tone)
- [x] Wavefolder (smooth folding with symmetry/expression)
- [x] Bitcrusher (sample rate + bit depth reduction)

### Phase 5: Dynamics Effects - COMPLETE
- [x] Compressor (ratio, threshold, attack, release, makeup)
- [x] Sustain (upward compression with gate)

### Phase 6: Spectral Effects - COMPLETE
- [x] RingModulator (carrier with waveform morphing)
- [x] PitchShifter (granular pitch shift +/- 12 semitones)
- [x] SubBoost (sub-octave generator with pitch tracking)
- [x] LoFi (noise, wow/flutter, filtering, bit crushing)
- [x] Equalizer (3-band parametric EQ)

### Phase 7: MI-Style Effects - COMPLETE
- [x] Rings (16-mode modal resonator bank)
- [x] Clouds (8-grain granular processor with freeze)
- [x] AmpSimulator (JCM800-style transfer function with EQ)

### Phase 8: Integration - COMPLETE
- [x] Integrate into all 36 patches
- [x] Preset save/load (skipped per user request)

**Total Effects Implemented: 22/22**
**Total Lines of Code: ~3000**
**Total Patches Integrated: 36/36**

---

## PHASE 9: DSP OPTIMIZATION - USER TESTING FEEDBACK

### Testing Date: 2025-12-26

> **IMPORTANT:** For ALL fixes below, check the corresponding SuperCollider source files in
> `patches/FX_to_REFERENCE/pedalboard-master/lib/fx/` to match the working SC implementation as closely as possible.

---

## CRITICAL: AUDIO ENGINE CRASHES

The following effects **kill the audio engine entirely** and must be fixed first:

| Effect | Status | SC Reference File |
|--------|--------|-------------------|
| **Wavefolder** | CRASHES | `third_party/SmoothFold.sc` |
| **Bitcrusher** | CRASHES | `Bitcrusher.sc` |
| **Sub Boost** | CRASHES | `SubBoost.sc` |
| **Lo-Fi** | CRASHES | `LoFi.sc` |
| **Equalizer** | CRASHES | `Equalizer.sc` |

**Likely causes:**
- NaN propagation from division by zero or invalid math
- Infinite loops in DSP code
- Buffer overruns
- Missing safety clamps on values

**Debug approach:**
1. Add `isNaN()` and `isFinite()` checks to all effect outputs
2. Add `Math.max(-10, Math.min(10, output))` safety clamps
3. Check for division by zero in all calculations
4. Test each effect in isolation
5. **Compare line-by-line with SC source to find divergence**

---

## EFFECTS THAT DON'T WORK AT ALL

### Reverb
- **Status:** Doesn't work
- **Shimmer:** Causes runaway feedback loop (amplitude explodes)
- **Fix needed:** Complete rewrite, disable shimmer feedback until stable
- **SC Reference:** `Reverb.sc` - check the exact algorithm and parameter mappings

### Delay
- **Status:** No audible difference between modes (Digital/Analog/Tape/Lo-Fi)
- **Fix needed:** Each mode should have distinct character
- **SC Reference:** `Delay.sc` - verify each quality mode implementation matches SC

### Sustain
- **Status:** Not working correctly in several ways
- **Fix needed:** Review compression logic, may need complete rewrite
- **SC Reference:** `Sustain.sc` - check CompanderD usage and parameter ranges

---

## EFFECTS THAT SOUND WRONG

### Phaser
- **Status:** Doesn't sound like a phaser
- **Expected:** Swooshing, jet-like sweep
- **Actual:** Not creating proper notch sweep
- **SC Reference:** `Phaser.sc` - verify allpass chain and LFO modulation

### Vibrato
- **Status:** Sounds like very weak tremolo
- **Expected:** Pitch wobble
- **Actual:** Volume wobble (wrong modulation target)
- **SC Reference:** `Vibrato.sc` - ensure delay time is modulated, not amplitude

### AutoWah
- **Status:** Very quiet, sounds like bad lowpass filter
- **Expected:** Envelope-controlled filter sweep (wah effect)
- **Actual:** No real modulation, just quiet filtering
- **SC Reference:** `AutoWah.sc` - check envelope follower and filter modulation

### Overdrive
- **Status:** Only makes sound on certain sections of Tone slider
- **Expected:** Warm saturation across all settings
- **Actual:** Broken tone control, possibly filtering signal to silence
- **SC Reference:** `Overdrive.sc` - check tone filter implementation

### Distortion
- **Status:** Same issues as Overdrive
- **Expected:** Harder clipping than overdrive
- **Actual:** Broken tone control
- **SC Reference:** `Distortion.sc` - check tone filter implementation

### Ring Mod
- **Status:** Same issues as Overdrive/Distortion
- **Expected:** Metallic, bell-like modulation
- **Actual:** Broken, possibly same tone control bug
- **SC Reference:** `RingModulator.sc` - check modulation and tone filter

### Pitch Shifter
- **Status:** Drift parameter adds noise, sounds cheap
- **Expected:** Clean pitch shifting with optional drift for detuning
- **Actual:** Noisy, low quality
- **SC Reference:** `PitchShifter.sc` - check granular implementation and drift

### Rings
- **Status:** Mostly sounds like distortion
- **Notes:** With right settings gets "kind of close" to resonator
- **Fix needed:** Reduce input gain, improve modal response
- **SC Reference:** `Rings.sc` - verify modal synthesis approach matches SC

### Clouds
- **Status:** Reverb parameter not working properly
- **Notes:** Core granular may be OK, but internal reverb broken
- **SC Reference:** `Clouds.sc` - check granular and reverb implementation

---

## EFFECTS STATUS SUMMARY

| Effect | Status | Priority | SC Reference |
|--------|--------|----------|--------------|
| Wavefolder | CRASH | P0 | `third_party/SmoothFold.sc` |
| Bitcrusher | CRASH | P0 | `Bitcrusher.sc` |
| Sub Boost | CRASH | P0 | `SubBoost.sc` |
| Lo-Fi | CRASH | P0 | `LoFi.sc` |
| Equalizer | CRASH | P0 | `Equalizer.sc` |
| Reverb | BROKEN | P1 | `Reverb.sc` |
| Sustain | BROKEN | P1 | `Sustain.sc` |
| Delay modes | NOT WORKING | P1 | `Delay.sc` |
| Phaser | WRONG SOUND | P2 | `Phaser.sc` |
| Vibrato | WRONG SOUND | P2 | `Vibrato.sc` |
| AutoWah | WRONG SOUND | P2 | `AutoWah.sc` |
| Overdrive | BROKEN TONE | P2 | `Overdrive.sc` |
| Distortion | BROKEN TONE | P2 | `Distortion.sc` |
| Ring Mod | BROKEN TONE | P2 | `RingModulator.sc` |
| Pitch Shifter | LOW QUALITY | P3 | `PitchShifter.sc` |
| Rings | MOSTLY DISTORTION | P3 | `Rings.sc` |
| Clouds reverb | NOT WORKING | P3 | `Clouds.sc` |
| Chorus | NEEDS TESTING | ? | `Chorus.sc` |
| Tremolo | NEEDS TESTING | ? | `Tremolo.sc` |
| Flanger | NEEDS TESTING | ? | `Flanger.sc` |
| Compressor | NEEDS TESTING | ? | `Compressor.sc` |
| Amp Sim | NEEDS TESTING | ? | `AmpSimulator.sc` |

---

## FIX PRIORITY ORDER

> **For each fix:** Read the SC source file first, trace the signal flow, then port accurately to JS.

### P0: Fix Crashes (Do First)
1. Wavefolder - check `third_party/SmoothFold.sc`, fix folding loop, add iteration limit
2. Bitcrusher - check `Bitcrusher.sc`, fix decimator division
3. Sub Boost - check `SubBoost.sc`, fix pitch detection division
4. Lo-Fi - check `LoFi.sc`, fix all processing stages
5. Equalizer - check `Equalizer.sc`, fix biquad coefficient calculation

### P1: Fix Broken Effects
1. Reverb - check `Reverb.sc`, disable shimmer, fix core algorithm
2. Sustain - check `Sustain.sc`, rewrite compression logic
3. Delay modes - check `Delay.sc`, implement distinct character per mode

### P2: Fix Wrong-Sounding Effects
1. Tone control bug - check `Overdrive.sc`/`Distortion.sc`/`RingModulator.sc` tone sections
2. Vibrato - check `Vibrato.sc`, modulate delay time not amplitude
3. Phaser - check `Phaser.sc`, fix allpass cascade and LFO modulation
4. AutoWah - check `AutoWah.sc`, fix envelope follower and filter modulation

### P3: Quality Improvements
1. Pitch Shifter - check `PitchShifter.sc`, fix drift, improve quality
2. Rings - check `Rings.sc`, reduce gain, tune modal response
3. Clouds reverb - check `Clouds.sc`, fix internal allpass network

---

## COMMON ISSUES TO CHECK

### Tone Control Bug
Multiple effects (Overdrive, Distortion, Ring Mod) have same symptom:
- Only audible on certain Tone slider positions
- Likely: MoogLadder filter going silent at certain cutoff frequencies
- Check: `MoogLadder.setCutoff()` and `process()` methods
- **Compare with SC:** Check how SC handles tone filtering in each effect
- Fix: Add minimum cutoff, check for NaN in filter state

### Modulation Target Bug
Vibrato sounds like Tremolo suggests:
- LFO is modulating amplitude instead of delay time
- Check: `VibratoEffect.processEffect()` - verify delay modulation

### Envelope Follower Issues
AutoWah not modulating suggests:
- Envelope follower not detecting input level
- Or filter not responding to envelope
- Check: `EnvelopeFollower` class and `AutoWahEffect`

---

## PREVIOUS NOTES (For Reference)

### Critical Bug: Effect Chain Slot Management
**Issue:** When removing effects from chain, subsequent effects may stop working.
**Status:** May be fixed by clearChain rebuild, needs retesting

### File Locations
- **Effects Code:** `/lib/pedalboard-effects.js`
- **UI Code:** `/lib/effect-ui.js`
- **Styles:** `/lib/effect-ui.css`

### Quick Test
```bash
python3 -m http.server 8080
# Open http://localhost:8080/patches/passersby-01.html
```

---

## DEBUGGING TEMPLATE

For each crashing effect:
```javascript
processEffect(inL, inR) {
  // Add at start:
  if (!isFinite(inL)) inL = 0;
  if (!isFinite(inR)) inR = 0;

  // ... existing code ...

  // Add before return:
  if (!isFinite(outL) || !isFinite(outR)) {
    console.error('NaN in EffectName');
    return [inL, inR]; // passthrough on error
  }
  return [
    Math.max(-2, Math.min(2, outL)),
    Math.max(-2, Math.min(2, outR))
  ];
}
```
3. Pitch shifting per-grain via playback rate
4. Freeze should stop buffer writes but continue grain playback
5. Density controls grain spawn rate (grains/second)
6. Size controls grain duration (10ms-500ms)

**Key Issues in Current Code:**
- Grain spawn timer logic may be wrong
- Grain phase advancement doesn't account for pitch properly
- Buffer indexing may wrap incorrectly
- Need better window function (Hann is correct but check implementation)

---

### Priority 3: SOUND QUALITY IMPROVEMENTS

#### Delay - Quality Modes Need Work
**Current Issues:**
- Analog mode: may not have warm enough character
- Tape mode: needs better wow/flutter modulation, saturation
- Lo-Fi mode: decimation may be too harsh

**Fixes:**
1. Add subtle pitch modulation to tape mode
2. Analog mode needs proper soft saturation curve
3. Lo-Fi needs noise injection before decimation
4. All modes need proper crossfade when delay time changes

#### Lo-Fi Effect - Needs Tuning
**Issues:**
- Compression may be too aggressive
- Noise levels may be wrong
- Wow/flutter rate may not match SC

**SC Reference Values:**
- Compression ratio: 0.15-0.01 (very aggressive)
- Wow rate: 0.5-4 Hz
- Depth in cents for wow: 1-35 cents

#### Pitch Shifter - Granular Quality
**Issues:**
- May have artifacts at grain boundaries
- Pitch accuracy may be off

**Fixes:**
1. Use proper overlapping grains (50% overlap minimum)
2. Hann window for smooth crossfades
3. Grain size should adapt to pitch ratio
4. Add time dispersion for more natural sound

#### Sub Boost - Pitch Tracking
**Issues:**
- Zero-crossing pitch detection is very crude
- May produce wrong sub frequencies

**Better Approach:**
1. Use autocorrelation for pitch detection
2. Or use a simple octave divider approach (flip-flop on zero crossing)
3. Add hysteresis to prevent glitching
4. Heavy lowpass on the sub signal

---

### Priority 4: FILTER IMPLEMENTATIONS

#### MoogLadder Filter
**Check:** Current implementation may not have proper resonance behavior
**Should:** Self-oscillate near resonance=1, have 24dB/oct slope

#### Biquad Shelf Filters
**Check:** setLowShelf and setHighShelf may have wrong gain calculation
**SC uses:** BLowShelf with dB gain, need to convert properly

#### Allpass for Phaser
**Check:** Phase response may not be correct for phaser sound
**Should:** Create notches that sweep with LFO

---

### Testing Approach

For each effect optimization:
1. Read the SC source file in `patches/FX_to_REFERENCE/pedalboard-master/lib/fx/`
2. Compare parameter mappings (linlin/linexp ranges)
3. Trace signal flow step by step
4. Test with simple sine wave input
5. Compare output character to SC (if possible)

### File Locations

**Main Effects Code:** `/lib/pedalboard-effects.js` (~3000 lines)
- Utility classes: lines 1-500
- Effect classes: lines 500-3000
- Effect Registry: end of file

**UI Code:** `/lib/effect-ui.js` (~700 lines)
- Effect definitions with params: lines 17-265
- EffectChainProcessor (embedded): lines 270-360
- UI rendering: lines 360-end

**CSS:** `/lib/effect-ui.css`

### Quick Test Server
Run `python3 -m http.server 8080` from project root, open http://localhost:8080

---

## SuperCollider to JavaScript Translation Guide

### Common SC UGens -> JS Equivalents

| SC UGen | Parameters | JS Implementation |
|---------|------------|-------------------|
| `DelayC.ar` | signal, maxDelay, delayTime | `DelayLine.readCubic(delaySamples)` |
| `DelayL.ar` | signal, maxDelay, delayTime | `DelayLine.readLinear(delaySamples)` |
| `AllpassL.ar` | signal, maxDelay, delayTime, decayTime | `AllpassFilter.process(input, delay, feedback)` |
| `BufDelayL.ar` | buffer, signal, delayTime | Same as DelayL but uses pre-allocated buffer |
| `HPF.ar` | signal, freq | `Biquad.setHighpass(freq, 0.707, sr)` |
| `LPF.ar` | signal, freq | `Biquad.setLowpass(freq, 0.707, sr)` |
| `BPF.ar` | signal, freq, rq | `Biquad.setBandpass(freq, 1/rq, sr)` |
| `RLPF.ar` | signal, freq, rq | `Biquad.setLowpass(freq, 1/rq, sr)` with resonance |
| `RHPF.ar` | signal, freq, rq | `Biquad.setHighpass(freq, 1/rq, sr)` with resonance |
| `MoogFF.ar` | signal, freq, gain | `MoogLadder.process(input)` - 4-pole ladder |
| `DFM1.ar` | signal, freq, res, inputgain, type | Diode ladder filter - use MoogFF approximation |
| `BLowShelf.ar` | signal, freq, db | `Biquad.setLowShelf(freq, db, sr)` |
| `BHiShelf.ar` | signal, freq, db | `Biquad.setHighShelf(freq, db, sr)` |
| `BPeakEQ.ar` | signal, freq, rq, db | `Biquad.setPeaking(freq, 1/rq, db, sr)` |
| `LeakDC.ar` | signal, coef=0.995 | DC blocking: `y = x - x1 + 0.995 * y1` |
| `Compander.ar` | signal, ctrl, thresh, slopeBelow, slopeAbove, attack, release | Custom compressor class |
| `Limiter.ar` | signal, level, dur | Lookahead limiter |
| `Decimator.ar` | signal, rate, bits | Sample/bit reduction |
| `PitchShift.ar` | signal, windowSize, pitchRatio, pitchDispersion, timeDispersion | Granular pitch shifter |
| `FreeVerb.ar` | signal, mix, room, damp | Schroeder reverb |
| `JPverb.ar` | signal, t60, damp, size, ... | Plate/algorithmic reverb |
| `SinOsc.ar/kr` | freq, phase, mul, add | `Math.sin(phase * 2 * Math.PI)` |
| `LFTri.ar/kr` | freq, iphase, mul, add | Triangle via phase |
| `LFSaw.ar/kr` | freq, iphase, mul, add | `phase * 2 - 1` |
| `LFPar.ar/kr` | freq, iphase, mul, add | Parabolic waveform |
| `LFPulse.ar/kr` | freq, iphase, width, mul, add | `phase < width ? 1 : 0` (unipolar) |
| `EnvFollow.ar` | signal, decayCoef | Envelope follower |
| `Pitch.kr` | signal, ... | Pitch detection (autocorrelation or YIN) |
| `LocalIn/LocalOut` | channels | Feedback loop state |
| `Shaper.ar` | buffer, signal | Waveshaping via transfer function |
| `Fold.ar` | signal, lo, hi | Wave folding |

### Parameter Mapping Functions

```javascript
// LinLin.kr(input, inMin, inMax, outMin, outMax)
function linlin(x, inMin, inMax, outMin, outMax) {
  return outMin + (x - inMin) * (outMax - outMin) / (inMax - inMin);
}

// LinExp.kr(input, inMin, inMax, outMin, outMax)
function linexp(x, inMin, inMax, outMin, outMax) {
  return outMin * Math.pow(outMax / outMin, (x - inMin) / (inMax - inMin));
}

// Select.kr(which, array) - choose based on index
function select(which, array) {
  return array[Math.floor(which)];
}

// Select.ar for audio - crossfade or switch
```

### Clipping/Saturation

```javascript
// .softclip - soft saturation (tanh-like)
function softclip(x) {
  const absX = Math.abs(x);
  if (absX <= 0.5) return x;
  return Math.sign(x) * (absX - 0.25) / absX;
}

// .distort - harder clipping
function distort(x) {
  return x / (1 + Math.abs(x));
}

// .tanh - hyperbolic tangent saturation
function tanh(x) {
  return Math.tanh(x);
}
```

---

## Effect-by-Effect DSP Notes

### 1. DELAY (Delay.sc)
**Parameters:** time, feedback, quality, mode
**Modes:** 0=normal, 1=ping-pong, 2=slapback

**Quality Processing:**
- 0 (digital): clean passthrough
- 1 (analog): HPF(25Hz) -> gain*1.4 -> softclip -> LPF(4500Hz) -> *0.73
- 2 (tape): MoogFF(10kHz) -> MoogFF(5kHz) + pink noise + warble modulation
- 3 (lo-fi): LPF(3500Hz) + noise -> Decimator(16kHz, 12bit) -> HPF(260Hz) -> MoogFF(5kHz)

**Key Implementation:**
- Crossfade between two delay times when time changes (avoid clicks)
- Feedback soft-clips when >= 1.0 to prevent runaway
- Slapback mode: feedbackOutputMul = 0 (no feedback)
- Ping-pong: cross-channel feedback

### 2. REVERB (Reverb.sc)
**Parameters:** size, decay, shimmer, tone

**Signal Flow:**
1. Tone filter (MoogFF 10Hz-20kHz or HPF 20Hz-21kHz based on tone > 0.75)
2. JPverb with modulated t60, damp, size, earlyDiff
3. Shimmer: PitchShift +2 octaves fed back via LocalIn/LocalOut

**Key Values:**
- size: 0.5-5 (room dimensions)
- t60: 0.1-45 seconds (decay time)
- Shimmer amount controls feedback of pitch-shifted signal

### 3. CHORUS (Chorus.sc)
**Parameters:** rate, depth

**Implementation:**
- 4 parallel delay lines
- Each modulated by LFPar (parabolic) with slight random detuning (0.95-1.05x)
- Phase offset between voices: 0.9 * voiceIndex
- Rate: 0.025-2 Hz
- Delay range: 12-52ms based on depth

### 4. TREMOLO (Tremolo.sc)
**Parameters:** time (rate), depth, shape

**Shape Wavetable:** sin -> tri -> saw -> sqr (0-1 crossfade)
- 0-0.33: sin->tri
- 0.33-0.67: tri->saw
- 0.67-1: saw->sqr

**Implementation:** Amplitude modulation (unipolar 0-1)

### 5. FLANGER (Flanger.sc)
**Parameters:** rate, depth, feedback, predelay

**Key Values:**
- maxDelay: 10.5ms
- rate: 0.1-8 Hz
- depth: 0.25ms - 4.7ms
- feedback: 0-1.1 (beyond unity with softclip)

**Implementation:** Short modulated delay + feedback loop

### 6. PHASER (Phaser.sc)
**Parameters:** rate, depth

**Implementation:**
- 4 cascaded allpass filters
- Each modulated by LFPar with phase offset
- Rate: 0.275-16 Hz
- maxDelay per stage: 2.5ms

### 7. VIBRATO (Vibrato.sc)
**Parameters:** rate, depth, expression

**Key Feature:** Expression = envelope following
- Louder signal = more vibrato
- Rate: 0.75-60 Hz
- Depth: 3.3-30 cents pitch bend

**Implementation:** Modulated delay with envelope-scaled modulation depth

### 8. AUTOWAH (AutoWah.sc)
**Parameters:** rate, depth, sensitivity, mode, res

**Modes:** 0=lowpass, 1=bandpass, 2=highpass
**Implementation:** Dual formant filters controlled by envelope follower
- Two parallel RLPF/BPF/RHPF at different frequency bands
- Envelope controls cutoff frequencies

### 9. OVERDRIVE (Overdrive.sc)
**Parameters:** drive, tone

**Signal Flow:**
1. HPF(25Hz)
2. Gain 1-3x -> softclip
3. Tone filter (MMF or HPF based on tone value)

### 10. DISTORTION (Distortion.sc)
**Parameters:** drive, tone

**Signal Flow:**
1. HPF(25Hz)
2. Gain 1-5x (exponential) -> .distort
3. Tone filter

### 11. WAVEFOLDER (Wavefolder.sc)
**Parameters:** amount, symmetry, smoothing, expression

**Key Feature:** SmoothFoldS with sine-smoothed corners
- Gain 1-20x before folding
- Compensation gain after folding
- Expression mixes fixed gain vs envelope follower

### 12. BITCRUSHER (Bitcrusher.sc)
**Parameters:** bitrate, samplerate, tone, gate

**Signal Flow:**
1. HPF(25Hz)
2. Noise gate (Compander with high ratio)
3. LPF (anti-aliasing)
4. Decimator (sample rate + bit reduction)
5. Tone filter

### 13. COMPRESSOR (Compressor.sc)
**Parameters:** drive, tone

**Key Values:**
- ratio: 0.25-0.05 (inverse - higher drive = more compression)
- threshold: 0.9-0.5
- attack: 5ms, release: 100ms
- Makeup gain calculated to maintain unity at threshold

### 14. SUSTAIN (Sustain.sc)
**Parameters:** drive, gate, tone

**Implementation:** Noise gate -> CompanderD (downward expansion)
- Very fast attack/release for infinite sustain effect

### 15. RING MODULATOR (RingModulator.sc)
**Parameters:** freq, follow, freq_mul, shape, tone

**Key Feature:** Optional pitch tracking (follow mode)
- Shape: sin->tri->saw->sqr wavetable
- Multiplies input by modulator

### 16. PITCH SHIFTER (PitchShifter.sc)
**Parameters:** freq_mul, drift

**Implementation:** SC's PitchShift.ar (granular)
- Window size: 0.25s
- Drift controls pitch/time dispersion

### 17. SUB BOOST (SubBoost.sc)
**Parameters:** shape, num_octaves_down, amp, sensitivity

**Implementation:**
- Pitch tracking to detect fundamental
- Generate sub-octave with selectable waveform
- LPF at 300Hz to keep only sub frequencies
- Sensitivity controls threshold for activation

### 18. LO-FI (LoFi.sc)
**Parameters:** drive, tone, wow, noise

**Signal Flow:**
1. HPF(25Hz)
2. Aggressive compression (slow attack/release, hard ratio)
3. Wow/flutter (vibrato-style modulation)
4. Tape noise (Dust2 + Crackle + filtered PinkNoise)
5. Saturation (tanh)
6. Filtering + bit crushing

### 19. EQUALIZER (Equalizer.sc)
**Parameters:** ls_freq, ls_amp, mid_freq, mid_q, mid_amp, hs_freq, hs_amp

**Implementation:**
- BLowShelf -> BPeakEQ -> BHiShelf
- Standard 3-band parametric

### 20. RINGS (Rings.sc) - MI Rings
**Parameters:** pit, follow, interval, struct, bright, damp, pos, poly, model, easteregg

**Note:** Uses MiRings UGen - this is a modal resonator synthesis
- For JS: implement modal synthesis with bank of bandpass filters
- Or simplified version with tuned resonators

### 21. CLOUDS (Clouds.sc) - MI Clouds
**Parameters:** pit, pos, size, dens, tex, spread, fb, freeze, rvb, lofi, mode

**Note:** Uses MiClouds UGen - granular processor
- For JS: implement granular synthesis with overlapping grains
- Key: position, size, density, texture control grain behavior

### 22. AMP SIMULATOR (AmpSimulator.sc)
**Parameters:** drive, room, bass, mid, treble, presence

**Implementation:**
- Low-shelf pre-filtering
- Marshall JCM800 transfer function waveshaping
- EQ section (bass, mid, treble, presence)
- FreeVerb for room simulation

**Transfer Function:** Piecewise polynomial approximating tube amp response

---

## Common Patterns

### Tone Control (used in many effects)
```javascript
// Tone 0-0.75: MMF (Moog lowpass) 10Hz-20kHz
// Tone 0.75-1: HPF 20Hz-21kHz
function getToneFreq(tone) {
  if (tone <= 0.2) return linexp(tone, 0, 0.2, 10, 400);
  if (tone <= 0.75) return linexp(tone, 0.2, 0.75, 400, 20000);
  return linexp(tone, 0.75, 1, 20, 21000);
}

function applyTone(sample, tone, filterState) {
  const freq = getToneFreq(tone);
  if (tone > 0.75) {
    return highpass(sample, freq, filterState);
  } else {
    return moogLowpass(sample, freq, 0.1, filterState);
  }
}
```

### Envelope Follower
```javascript
class EnvelopeFollower {
  constructor(decayCoef = 0.9999) {
    this.value = 0;
    this.decayCoef = decayCoef;
  }

  process(input) {
    const absIn = Math.abs(input);
    if (absIn > this.value) {
      this.value = absIn;
    } else {
      this.value *= this.decayCoef;
    }
    return this.value;
  }
}
```

### Feedback Loop Pattern
```javascript
// Store feedback sample from previous block
this.feedbackSample = 0;

// In process loop:
const feedbackIn = this.feedbackSample;
// ... process with feedbackIn ...
this.feedbackSample = outputToFeedback;
```

---

## Files Reference

### SuperCollider Source Files
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Pedal.sc` - Base class
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Delay.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Reverb.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Chorus.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Tremolo.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Flanger.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Phaser.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Vibrato.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/AutoWah.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Overdrive.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Distortion.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Wavefolder.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Bitcrusher.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Compressor.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Sustain.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/RingModulator.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/PitchShifter.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/SubBoost.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/LoFi.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Equalizer.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Rings.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/Clouds.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/AmpSimulator.sc`
- `FX_to_REFERENCE/pedalboard-master/lib/fx/third_party/SmoothFold.sc`

### Existing Patch DSP Reference
- `patches/molly-01.html` - Moog ladder filter, chorus, compression
- `patches/passersby-01.html` - Spring reverb, wave folding, FM
- `patches/patch-03-allpass-comb.html` - Reverb architecture
- `patches/host-01.html` - SVF filters, delay implementation
