# ER-301 to AudioWorklet Conversion Project Tracker

## Project Overview

Converting ER-301 (Orthogonal Devices Sound Computer) patches to web-based AudioWorklet implementations for the Phonebook project.

**Total Patches:** 108
- Hyperscale Units: 67 patches (from mudlogger)
- Autogen301: 41 patches (from mudlogger)

**Approach:** Quality first - each patch fully functional with:
- Sample visualization grid showing playback
- Complete control mapping
- Info panel with documentation
- Proper DSP implementation

**Dependencies Available:**
- Accents v0.6.16
- Band Limited Oscillators v0.0.2
- Filter Delays v1.4.0
- Lojik v1.2.0
- Sloop v1.0.3
- Strike v2.0.0
- autogen301 (standalone package)

---

## Architecture & Implementation Notes

### ER-301 Unit Structure
The ER-301 .pkg files are ZIP archives containing:
- `toc.lua` - Table of contents with metadata (name, author, presets)
- `*.unit` - Lua serialized patch data (ASCII text)
- `front/Samples/**/*.wav` - Bundled audio samples

### Unit File Components
- **controlOrder**: Array defining UI control order
- **controlBranches**: Parameter definitions with types (GainBias, Pitch, Gate)
- **bands/units**: Signal processing chain with nested units
- **loadInfo**: Unit type identification (Oscillators, Filters, Containers, etc.)

### Web Implementation Pattern
Each patch will be a self-contained HTML file with:
1. **Info Panel** (toggleable) - Description, instructions, controls reference
2. **Sample Management** - Default samples bundled, custom import option
3. **UI Controls** - Mapped from ER-301 controlOrder
4. **AudioWorklet Processor** - DSP implementation
5. **Visualizer** - Waveform/spectrum display
6. **Effects Chain** - PedalboardUI integration

### Sample Handling Strategy
- Extract WAV samples from .pkg files
- Store in organized folder structure: `er-301-patches/samples/{patch-name}/`
- Load samples as ArrayBuffers in AudioWorklet
- Support drag-and-drop/file picker for custom samples

---

## Phase 1: Hyperscale Units (67 patches)

### Collection Info
- **Source:** `er301-hyperscale-units-main/`
- **Requirements:** 48kHz/128smps, stereo linked channels
- **Video demos:** Available on YouTube

### Patch List with Status

| # | Patch Name | Status | Samples | Notes |
|---|------------|--------|---------|-------|
| 1 | bend | [x] Complete | S&B Kit (72 files) | Sample mangler with delay + reverb |
| 2 | bento box | [x] Complete | Bent-O-Box (64 files) | Circuit-bent MPC samples with LFO modulation |
| 3 | big | [x] Complete | None (synth) | Generative FM synth with Amie, quantizer, fold, FDN |
| 4 | bongo phase | [x] Complete | Conga Battery (48 files) | 6-voice polyrhythmic sampler, grain+spread delay, Freeverb |
| 5 | bongo rom | [x] Complete | Conga Battery (47 files) | 6-voice ROM sampler with external triggers, Freeverb |
| 6 | bottles | [x] Complete | Sutra Kit (54 files) | Euclidean sequencer, Chance, Clocked Delay, Dattorro Reverb |
| 7 | chance | [x] Complete | Wave Alchemy (57 files) | Probabilistic 3-kit sampler, Ring Mod, Clocked Delay, CPR |
| 8 | coastal | [x] Complete | Arp 2600 Kit (119 files) | Granular sampler with LPG, Feedback Looper, Doppler Delay, Dattorro Reverb |
| 9 | dialled in | [x] Complete | None (pure synth) | Generative FM synth: Amie osc, Scale Quantizer, Wave Folder, dual Clocked Doppler Delays, Andromeda Reverb, CPR |
| 10 | dorian | [x] Complete | None (pure synth) | Dual-voice Amie FM in Dorian mode, Pingable Scaled Random, Spread Delay, Freeverb, CPR |
| 11 | edev | [x] Complete | Richard Devine Kit 1 (71 files) | 4-voice Euclidean sampler, Chance gates, Pingable Scaled Random pitch, Spread Delay |
| 12 | edigi | [x] Complete | Wave Alchemy Driven Digital Kit (23 files) | 4-voice Euclidean sampler, Freeverb, random pitch modulation |
| 13 | emono | [x] Complete | Monolith 2 Kit (37 files) | 4-voice Euclidean sampler, random clock/pitch/delay, pattern rotation, Spread Delay |
| 14 | endless bongo | [x] Complete | Conga Battery (47 files) | 6-voice generative conga, independent clocks, probability gates, Freeverb |
| 15 | endless marimba | [x] Complete | Marimba C2/C3/C5 (3 files) | 6-voice generative marimba, independent clocks, probability gates, Freeverb |
| 16 | ezil | [x] Complete | None (pure synth) | West Coast dual osc, aliasing waves, LPG, mod bus, Clocked Doppler Delay, Tanh drive |
| 17 | ezil rev 2 | [x] Complete | None (pure synth) | Simplified stereo Doppler delay with independent L/R times, extended timbre range, MIDI |
| 18 | fragments | [x] Complete | Pop Composer #1 (98 files) | Grain Stretch player, dual LFOs, stereo delay with LFO mod, Dattorro reverb |
| 19 | gaston | [x] Complete | None (pure synth) | Generative FM synth, probability gates, Pingable Scaled Random, Bique BP filter, Clocked Doppler Delay, CPR |
| 20 | gran | [x] Complete | Cannon Fodder (1 file, 42MB) | Manual Grains player, Carousel Clock Divider, Pingable Scaled Random, Freeverb, CPR |
| 21 | gritch25 | [x] Complete | Wave Alchemy Synth XS Kit (29 files) | Euclidean Variable Speed Player, FDN reverb, Clocked Doppler Delay, Bique filter, wiggle modulation |
| 22 | grove | [x] Complete | None (pure synth) | West Coast dual Formant oscillators, FM, Strike LPG, Arc AD mod env, Bique filter, noise, Clocked Doppler Delay, MIDI |
| 23 | grove rev 2 | [x] Complete | None (pure synth) | Enhanced grove with Internal Sync, Octave controls, Clocked Random Gate auto-trigger, separate Glide time, independent stereo delay L/R, expanded noise controls, Mod Envelope bend |
| 24 | hamming | [x] Complete | Konkrete FX Hamming Kit (54 files) | Grain Stretch player, Clocked Random Gate, ADSR envelope, HP filter, Halo stereo, Grain Delay, Clocked Delay, Freeverb |
| 25 | hyper scale | [x] Complete | Dr. Dre Drum Kit Vol 3 (243 files) | Flagship generative drum machine, dual Clocked Random Gates, Pingable Scaled Random pitch, Slew Limiter, CPR compression |
| 26 | hyper301 | [x] Complete | Konkrete FX Drills Kit2 (54 files) | Extended hyperscale with Velvet Noise, dual Clocked Random Gates, industrial/glitch percussion |
| 27 | jitter | [x] Complete | Tubed Digital Kit (24 files) | Dual Aliasing Triangle LFO "jitter" modulation, Grain Stretch, Clocked Random Gate, Pingable Scaled Random pitch, Stereo Delay (LFO mod), Dattorro Reverb, CPR |
| 28 | kalimba hell | [x] Complete | EIIIX Killer Kalimba (12 files) | Grain Stretch, Clocked Random Gate, Scale Quantizer, EQ3, Tuned Filter Delay (comb), Freeverb, CPR |
| 29 | krystal kastles | [x] Complete | Freesound Wind Chimes (1 file) | 3-voice Manual Loops with Aliasing Triangle LFOs, Stutter/Dub Looper, Manual Grains, Clocked Random Gate, Andromeda Nebula shimmer reverb, CPR |
| 30 | luthier | [x] Complete | Luthier String Percussion (61 files) | Dual Clocked Random Gates, Tap Tempo, Clocked Stretch, Skewed Sine Envelope, Velvet Noise, Clocked Delay, CPR |
| 31 | lutq | [x] Complete | Luthier String Percussion (61 files, shared) | Extended luthier with FM modulation (probabilistic), Grid Quantizer (bit crush), Freeze Looper, ADSR, Grain Delay, Dattorro Reverb, Tap Tempo, CPR |
| 32 | manq | [x] Complete | Abstrakt Konkrete Vol.2 Macro (91 files) | Same DSP as lutq with FM, Grid Quantizer (bit crush), Freeze Looper, ADSR, Grain Delay, Dattorro Reverb, Tap Tempo, CPR |
| 33 | mantis | [x] Complete | S&B Kit (72 files, shared with bend) | LFO modulation (speed + stereo spread), Clocked Random Gate, Clocked Doppler Delay, Dattorro Reverb, CPR |
| 34 | marimba rom | [x] Complete | EIIIX Marimba (3 files, shared with endless marimba) | 6-voice ROM sampler, external triggers (gate1-6), individual tuning per voice, MIDI playable, Pingable Scaled Random pitch, Freeverb, CPR |
| 35 | mesh | [x] Complete | Konkrete Nannou Kit (54 files) | Velvet Noise, Tap Tempo, complex clock Mul/Div with probability, Clocked Random Gate, Clocked Delay, Dattorro Reverb, CPR |
| 36 | metab | [x] Complete | Abstrakt Konkrete Vol.2 Meta (118 files) | FM modulation (probability), ADSR Envelope, Grid Quantizer (bit crush), Grain Delay, Freeze Looper, Clocked Delay, Dattorro Reverb, CPR |
| 37 | monolith | [x] Complete | Monolith 1 Kit (51 files) | 4-voice Euclidean rhythm generator, per-voice beats/length/prob/tune, Pingable Scaled Random pitch, Clocked Doppler Delay, CPR |
| 38 | ninja | [x] Complete | Konkrete Ninja Kit (54 files) | Clocked Stretch, Clocked Random Gate, Pingable Scaled Random pitch, Clocked Delay, MIDI playable (C2+), CPR |
| 39 | noise merchant | [x] Complete | None (pure synth) | Dual Formant oscillators with cross-modulation, Sieve SVF filter with feedback, MIDI playable, CPR |
| 40 | ota | [x] Complete | None (pure synth) | Dual Aliasing Triangle oscs with sync, Ring Modulator, White/Pink Noise, Arc AD + ADSR envelopes, Bique filter, Spread Delay, Dattorro Reverb, MIDI playable, CPR |
| 41 | ota rev 2 | [x] Complete | None (pure synth) | Autogen mode with clock Mul/Div, Trigger Probability, Scale Quantizer, Clocked Random Gate, Strike LPG, Bandpass post-noise, Tanh saturation, Spread Delay, MIDI playable, CPR |
| 42 | ota rev 3 | [x] Complete | None (pure synth) | Aliasing Saw (Osc 1) + Aliasing Pulse with PW control (Osc 2), Sieve SVF filter with LP/BP/HP morphing (svMix), Strike LPG, Scale Quantizer, Autogen mode, Spread Delay, MIDI playable (CC2->PW, CC3->SV Mix), CPR |
| 43 | ota rev 4 | [x] Complete | None (pure synth) | Aliasing Saw + Pulse oscs, White/Pink Noise controls, Sieve SVF filter (LP/BP/HP morphing), Strike LPG with cutoff mod, Cycling Mod Envelope, Clocked Spread Delay (synced to BPM), Scale Quantizer, Autogen mode, MIDI playable (CC2->PW, CC3->SV Mix), CPR |
| 44 | piano esque | [x] Complete | Kawai 9' Grand (42 files) | Multi-sample piano with Variable Speed Player, Grain Stretch, Feedback Looper, random panning, autogen mode with Clock Mult, LPF tone control, Delay, MIDI velocity-sensitive, CPR |
| 45 | plaidium | [x] Complete | Plaidbat Kit (46 files) | Grain Stretch multi-sample player, Clocked Random Gate with prob/mult/div, ADSR envelope on pspeed, HP Filter (toggleable), Halo stereo spread, Grain Delay, auto-trigger mode, MIDI playable, CPR |
| 46 | pole | [x] Complete | Polesq Kit (131 files) | Minimal techno drum machine, Variable Speed Player, Clocked Random Gate, ADSR, Bitcrusher, FM modulation (probabilistic), Freeze with probability, Freeverb, MIDI playable, CPR |
| 47 | puls | [x] Complete | None (pure synth) | Generative pulse synth, Sine Osc with random pitch mod, Clocked Random Gate, Pingable Scaled Random, Slew Limiter, ADSR (fast attack/decay), Bique HP filter (random freq mod), Spread Delay, Dattorro Reverb, MIDI playable, CPR |
| 48 | r+r25 | [x] Complete | None (pure synth) | Blippoo Box/Rungler-inspired chaotic synth, Cross-modulated Square + Saw oscillators, 64-step Register (Rungler), Sample & Hold, Scale Quantizer, Bique bandpass filter, SFDN delay, Spread Delay, Freeverb (chaos-modulated), CPR |
| 49 | rescale | [x] Complete | Freeform Kit (61 files) | Granular sample explorer, Clocked Stretch granular player, Dual Clocked Random Gates (modulated prob/mult/div), Pingable Scaled Random (slice, tune, dur, feedback), Slew Limiters, Clocked Delay (random feedback, spread), CPR, MIDI playable |
| 50 | ria | [x] Complete | RIAA Kit (61 files) | RIAA drum machine, Variable Speed Player, ADSR, Clocked Random Gate with probability, Pingable Scaled Random, FM modulation (Sine Osc with Chance), Freeze Looper, EQ3, Grain Delay, Dattorro Reverb, CPR, Limiter, MIDI playable |
| 51 | ringing rocks | [x] Complete | Ringing Rocks (1 file, 107 slices) | Clocked Stretch granular player, Pingable Scaled Random (slice, tune, duration), Scale Quantizer (12-TET), Feedback Looper, Tuned Filter Delay with tone modulation, Freeverb with random modulation, CPR, MIDI playable |
| 52 | slaughter house | [x] Complete | Destiny Plus modelQ2a (1 file) | Manual Grains granular player, Pingable Scaled Random (pitch, 240 levels), Slew Limiter, Aliasing Saw + Sine Osc modulation, Spread Delay with cross-feedback, Grain Delay, Andromeda Nebula reverb, CPR, MIDI playable |
| 53 | speak and hell | [x] Complete | Speak & Spell (238 files: Alphabet 26, Circuit Bent 13, Numbers 11, Operating System 23, Words 165) | Grain Stretch multi-sample player, Clocked Random Gate with probability, Variable Speed Player (238 samples), EQ3, Tuned Filter Delay, Feedback Looper, Freeverb, CPR, MIDI playable with sample category selector |
| 54 | spook | [x] Complete | Konkrete Klang Glitch Kit (54 files) | Dual Clocked Random Gates (polyrhythm), Band Limited Square clock, Slew Limiter, Pingable Scaled Random (187 levels), Clocked Stretch granular, Clocked Delay (clock-synced), Feedback Delay Network (FDN) reverb, CPR, MIDI playable |
| 55 | sweet spot | [x] Complete | None (pure synth) | Generative West Coast synth with dual oscillators (slow sine LFO + aliasing triangle), Pingable Scaled Random (256/62 levels), Slew Limiters, Bique BCF filter (Q 0.47), Strike LPG, Tanh saturation, Doppler Delay (stereo cross-feedback), Freeverb (random size mod), CPR, MIDI playable |
| 56 | temple + rain | [x] Complete | Bent-O-Box Kit (64 files: Alpha-Bent 16, Bent N Math 32, Radio-Bent 16) | Atmospheric granular sampler with Manual Grains, Clocked Random Gate with probability, Pingable Scaled Random (offset, timbre), Slew Limiter, 3-band Bique filters (LP, HP, BP), White Noise, Dub Looper (punch in/overdub), Spread Delay (cross-feedback), CPR, MIDI playable |
| 57 | temple tantrum | [x] Complete | Wave Alchemy World Percussion (29 files) | BPM-synced world percussion sampler with Clock multiplier, Clocked Random Gate, Multiple Pingable Scaled Randoms (pitch, duration, tone), Scale Quantizer, Sine Osc modulation, Slew Limiter, Variable Speed Player, Grain Stretch, Feedback Looper, EQ3, Delay, Tuned Filter Delay, Freeverb, CPR, MIDI playable |
| 58 | tight rope | [x] Complete | Blips Loop (1 file) | Granular loop slicer with Velvet Noise triggers, dual Clocked Random Gates (polyrhythm), 3x Pingable Scaled Random (slice, tune, duration, feedback), Slew Limiter, Clocked Stretch granular player, Linear VCA, Clocked Delay (stereo spread, random FB mod), CPR, MIDI playable |
| 59 | tritone | [x] Complete | None (pure synth) | Dual oscillator synth tuned a tritone apart (6 semitones), dual Aliasing Triangle oscillators with Wave Fold, FM modulation (Osc 2->1), Slew Limiter (glide), White/Pink/Bandpass noise, Strike LPG with Arc AD envelope, Bique lowpass filter with mod envelope, Tanh saturation, Clocked Doppler Delay (stereo spread), CPR, Limiter, MIDI playable |
| 60 | tritone rev 2 | [x] Complete | None (pure synth) | Enhanced tritone with independent stereo delay times (L/R in seconds), Noise toggle, Mod Env toggle, MIDI playable |
| 61 | tube | [x] Complete | Tube Kit (60 files) | Tube kit drum machine with Variable Speed Player, Clocked Random Gate, Pingable Scaled Random, ADSR, Grid Quantizer (bitcrusher), Grain Delay, Clocked Delay, EQ3, Dattorro Reverb, CPR, FM modulation with probability, Freeze buffer, MIDI playable |
| 62 | tunnel vision | [x] Complete | Exile Kit 1 (59 files) + modelQ2a (1 file) | Dual-layer granular with Focus macro control, Manual Grains (granular pad), Variable Speed Player (59 Exile Kit samples), Aliasing Saw triggers, Pingable Scaled Random (pitch/slice), Slew Limiters, Andromeda Nebula reverb (Sine Osc mod), CPR, MIDI playable |
| 63 | twisted | [x] Complete | AKWF_hvoice Wavetables (104 files) | Wavetable synth with Single Cycle oscillator (104 human voice waveforms), Scan control with LFO modulation, Strike LPG (rise/fall/bend/height), Slew Limiter, Tanh drive, Spread Delay (cross-feedback), Bique BCF filter, Dattorro Reverb, CPR, Limiter, MIDI playable |
| 64 | ultra violet | [x] Complete | None (effect processor) | Granular freeze effect with 3-band container, Manual Grains (triggered via Sow), Feedback Looper with Freeze control, Dual Ladder Filters (HPF + LPF with Cut modulation), Freeverb diffusion, White Noise -> LPF modulation (Refract), Dry/Wet/Feed/Feedback mix, Position/Size/Shape/Pitch grain controls, Reverse playback, Seed LFO for auto-triggering, Pan spread, Multiple input sources (oscillator/file/microphone), MIDI playable |
| 65 | unskool | [x] Complete | Un_Skool HipHop Kit (68 files) | Hip-hop granular sampler, Tap Tempo clock with Wonky/Tonk multiplier modulation, Clocked Random Gate with probability, Grain Stretch player, Pingable Scaled Random (slice + pitch), Slew Limiter for smooth transitions, Grain Delay with stereo spread and pitch shift, Freeverb with size modulation, CPR dynamics, MIDI playable |
| 66 | velouria | [x] Complete | None (pure synth) | Dual-channel generative FM arpeggiator, Amie FM synth (2-op with carrier/modulator feedback), Infinity Arp generative arpeggiator, Scale Quantizer (major scale), Clocked gates with Mult/Div ratios, Strike LPG for dynamics, Octave CV Shifter, Clocked Delay, Slew Limiters, stereo panning, MIDI playable |
| 67 | vink | [x] Complete | None (effect processor) | 10-band Scorpio Vocoder effect processor (Accents), Ring Modulator with frequency CV, Feedback Looper (2 sec buffer, punch mode), Grain Delay with pitch/speed controls, Freeverb (size/damp/width), Multiple input sources (Oscillator/Microphone/USB), VCA feedback loop, Limiter output, MIDI playable |

---

## Phase 2: Autogen301 Patches (41 patches)

### Collection Info
- **Source:** `autogen301-main/`
- **License:** MIT (mudlogger)
- **Additional dependency:** Erosive (from forum)

### Patch List with Status

| # | Patch Name | Status | Type | Notes |
|---|------------|--------|------|-------|
| 1 | 1975 | [x] Complete | Synth | Dual arpeggiator with Sine + Formant oscs, Strike LPG, LFO mod, Freeverb, CPR |
| 2 | 217 levels | [x] Complete | Drums | Euclidean drum machine with 29 One Inch Punch Kit samples, 217-level random quantization, Bique filter, Freeverb, CPR |
| 3 | YOLO | [x] Complete | FX/Texture | Dual Shatttr texture generator with clocked random gates, pink/velvet noise, ADSR, clocked delay, Freeverb |
| 4 | ambikarp | [x] Complete | Synth/Arp | Ambient arpeggiator with single cycle osc, scale quantizer, clocked random CV, ADSR, clocked delay, CPR |
| 5 | auto Reels | [x] Complete | Looper/FX | Tape-style feedback looper with 3 playback heads, wow/flutter, variable speed, loop window controls |
| 6 | barbieri | [x] Complete | Synth | Dual aliasing oscillator synth (Saw + Pulse), scale quantizer, octave shifter, ADSR, clocked random |
| 7 | barton | [x] Complete | Synth | Noise synthesizer with white/pink/velvet noise, yin/yang ladder filters (HPF/LPF), wavefolding, sample & hold modulation, scale quantizer |
| 8 | belle reid | [x] Complete | Looper/Sampler | Brass sample granular looper with 12 EIIIX samples, Sloop looper, Manual Grains, Tap Tempo with Carousel Clock Divider, Chance probability gates, SFDN reverb |
| 9 | bent 808 | [x] Complete | Drums | Circuit-bent TR-808 with 68 samples, dual Euclidean sequencers with Chance probability gates, Filter Delays, Freeverb, CPR compression |
| 10 | broken memory | [ ] Not Started | TBD | Memory/sample |
| 11 | cave | [ ] Not Started | TBD | Reverb/space |
| 12 | clangers | [ ] Not Started | TBD | Metallic |
| 13 | don | [ ] Not Started | TBD | |
| 14 | drone | [ ] Not Started | Drone | Complex oscillator |
| 15 | fdn | [ ] Not Started | TBD | Feedback delay network |
| 16 | feedback physics | [ ] Not Started | TBD | Physical modeling |
| 17 | fields of mud | [ ] Not Started | TBD | |
| 18 | fields sine | [ ] Not Started | TBD | Sine-based |
| 19 | fields | [ ] Not Started | TBD | |
| 20 | finding jan | [ ] Not Started | TBD | |
| 21 | flam drum | [ ] Not Started | Drums | Flam patterns |
| 22 | for days | [ ] Not Started | TBD | |
| 23 | gas | [ ] Not Started | TBD | |
| 24 | gritch | [ ] Not Started | TBD | |
| 25 | harm osc | [ ] Not Started | Synth | Harmonic oscillator |
| 26 | ikeda | [ ] Not Started | TBD | Ryoji Ikeda style |
| 27 | in theory | [ ] Not Started | TBD | |
| 28 | indo chine | [ ] Not Started | TBD | Eastern influence |
| 29 | newdon | [ ] Not Started | TBD | |
| 30 | noodles | [ ] Not Started | TBD | |
| 31 | pause | [ ] Not Started | TBD | |
| 32 | pop | [ ] Not Started | TBD | |
| 33 | r+r | [ ] Not Started | TBD | |
| 34 | reaper | [ ] Not Started | TBD | |
| 35 | recur | [ ] Not Started | TBD | Recursive |
| 36 | sand grains | [ ] Not Started | TBD | Granular |
| 37 | splat | [ ] Not Started | TBD | |
| 38 | sway | [ ] Not Started | TBD | |
| 39 | tek | [ ] Not Started | TBD | Techno-inspired |
| 40 | tippy tap | [ ] Not Started | TBD | |
| 41 | zola budd | [ ] Not Started | TBD | |

---

## Shared Components to Create

### 1. ER-301 Base Template (`er301-template.html`)
- [ ] Standard HTML structure with info panel
- [ ] Sample loading utilities
- [ ] Common DSP utilities (DelayLine, Biquad, etc.)
- [ ] Control generation from patch metadata
- [ ] Visualizer integration
- [ ] PedalboardUI integration

### 2. Sample Manager (`lib/er301-sample-manager.js`)
- [ ] Load bundled samples from folder
- [ ] Decode audio files to AudioBuffer
- [ ] Sample import via file picker
- [ ] Drag-and-drop support
- [ ] Sample slot management
- [ ] Playback control (trigger, loop, one-shot)

### 3. Info Panel Component (`lib/er301-info-panel.js`)
- [ ] Toggleable visibility
- [ ] Patch description
- [ ] Control documentation
- [ ] Usage instructions
- [ ] Credits/attribution

### 4. ER-301 DSP Utilities (`lib/er301-dsp.js`)
- [ ] Band-limited oscillators (saw, square, triangle)
- [ ] Moog ladder filter emulation
- [ ] Complex oscillator (Buchla-style)
- [ ] Strike-style percussion synthesis
- [ ] Sloop-style looper
- [ ] Lojik-style logic operations
- [ ] Accents modulation
- [ ] Filter delays

### 5. Patch Index Page (`er-301-patches/index.html`)
- [ ] Gallery view of all patches
- [ ] Search/filter functionality
- [ ] Category organization
- [ ] Preview thumbnails

---

## Sample Extraction Tasks

### High Priority (Hyperscale with samples)
- [ ] Extract `hyper scale.pkg` samples (Dr. Dre Kit)
- [ ] Extract `bend.pkg` samples (S&B Kit)
- [ ] Audit all hyperscale packages for sample content
- [ ] Organize samples into standardized folder structure

### Sample Organization Structure
```
er-301-patches/
├── samples/
│   ├── hyperscale/
│   │   ├── hyper-scale/
│   │   │   ├── kick/
│   │   │   ├── snare/
│   │   │   ├── hat/
│   │   │   └── fx/
│   │   └── bend/
│   │       └── ...
│   └── autogen301/
│       └── ...
├── lib/
│   ├── er301-sample-manager.js
│   ├── er301-info-panel.js
│   └── er301-dsp.js
├── hyperscale/
│   ├── index.html
│   └── [patch-name].html (67 files)
├── autogen301/
│   ├── index.html
│   └── [patch-name].html (41 files)
└── index.html
```

---

## Implementation Priority Order

### Week 1: Foundation
1. [ ] Create shared utilities (sample manager, info panel, DSP)
2. [ ] Create base template
3. [ ] Extract and organize samples from first 5 hyperscale patches
4. [ ] Implement `hyper scale` as reference patch

### Week 2-3: Hyperscale Core
5. [ ] Implement 10 core hyperscale patches with different characteristics
6. [ ] Refine template based on learnings
7. [ ] Document common DSP patterns

### Week 4-6: Hyperscale Completion
8. [ ] Complete remaining 57 hyperscale patches
9. [ ] Create hyperscale index page

### Week 7-8: Autogen301
10. [ ] Adapt template for autogen301 patterns
11. [ ] Implement autogen301 patches
12. [ ] Create autogen301 index page

### Week 9: Polish
13. [ ] Cross-browser testing
14. [ ] Performance optimization
15. [ ] Documentation completion
16. [ ] Main index page with all patches

---

## Reusable Templates & Code Patterns

### From bend.html - First Reference Implementation

#### 1. DCBlocker (Prevents Reverb/Delay Runaway)
```javascript
class DCBlocker {
    constructor() {
        this.x1 = 0;
        this.y1 = 0;
        this.R = 0.995;
    }
    process(x) {
        const y = x - this.x1 + this.R * this.y1;
        this.x1 = x;
        this.y1 = y;
        return y;
    }
}
```

#### 2. Stable Dattorro Plate Reverb
Key stability fixes learned:
- DC blockers on input and output
- Reduced allpass coefficients (0.7 and 0.5 instead of 0.75 and 0.625)
- Decay clamping: `const d = Math.min(decay * 0.85, 0.85)`
- Input limiting: `input = Math.max(-1, Math.min(1, input))`
- Output soft clipping: `Math.tanh(output)`
- Damping frequency range: 200Hz - 15kHz

#### 3. Vari-Speed Sample Player with Pitch Distribution
```javascript
// Randomize playback rate for tape-style pitch shifting
const speedRand = Math.random();
if (speedRand < 0.3) {
    // 30% normal speed (0.9-1.1x)
    this.sampleSpeed = 0.9 + Math.random() * 0.2;
} else if (speedRand < 0.5) {
    // 20% pitched DOWN (0.5-0.9x)
    this.sampleSpeed = 0.5 + Math.random() * 0.4;
} else if (speedRand < 0.7) {
    // 20% pitched UP (1.1-1.6x)
    this.sampleSpeed = 1.1 + Math.random() * 0.5;
} else if (speedRand < 0.85) {
    // 15% very pitched DOWN (0.25-0.6x) - slow, deep
    this.sampleSpeed = 0.25 + Math.random() * 0.35;
} else {
    // 15% very pitched UP (1.5-2.0x) - fast, chipmunk
    this.sampleSpeed = 1.5 + Math.random() * 0.5;
}

// Linear interpolation for smooth pitch shifting
const idx = Math.floor(this.samplePosition);
const frac = this.samplePosition - idx;
const s0 = sample[idx];
const s1 = sample[idx + 1] || 0;
sampleOut = s0 + frac * (s1 - s0);
this.samplePosition += this.sampleSpeed;
```

#### 4. Sample Visualization Grid Pattern
HTML structure:
```html
<div class="sample-visualizer">
    <div class="sample-grid" id="sampleGrid"></div>
    <div class="now-playing" id="nowPlaying">Ready</div>
</div>
```

CSS (add to styles.css):
```css
.sample-visualizer {
    max-width: 800px;
    width: 100%;
    margin-top: 1rem;
}
.sample-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0.75rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    max-height: 120px;
    overflow-y: auto;
}
.sample-slot {
    width: 28px;
    height: 28px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.65rem;
    color: var(--text-secondary);
    transition: all 0.15s;
    cursor: default;
}
.sample-slot.playing {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
    box-shadow: 0 0 10px var(--glow);
    transform: scale(1.1);
}
.now-playing {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
    text-align: center;
}
```

JavaScript functions:
```javascript
function getSampleCategory(name) {
    const lower = name.toLowerCase();
    if (lower.includes('kick')) return 'Kick';
    if (lower.includes('snare')) return 'Snare';
    if (lower.includes('hat')) return 'Hat';
    if (lower.includes('clap')) return 'Clap';
    if (lower.includes('tom')) return 'Tom';
    if (lower.includes('crash')) return 'Crash';
    if (lower.includes('vox') || lower.includes('vocal')) return 'Vox';
    if (lower.includes('fx') || lower.includes('effect')) return 'FX';
    return 'Other';
}

function buildSampleGrid(names) {
    const grid = document.getElementById('sampleGrid');
    grid.innerHTML = names.map((name, i) =>
        `<div class="sample-slot" data-index="${i}" title="${name}">${i + 1}</div>`
    ).join('');
}

function updatePlayingSample(index, sampleNames) {
    document.querySelectorAll('.sample-slot').forEach((slot, i) => {
        slot.classList.toggle('playing', i === index);
    });
    const nowPlaying = document.getElementById('nowPlaying');
    if (index >= 0 && sampleNames[index]) {
        nowPlaying.textContent = `▶ ${sampleNames[index]}`;
        nowPlaying.style.color = 'var(--accent)';
    }
}
```

Worklet messaging:
```javascript
// In processor - send when sample triggers
this.port.postMessage({ type: 'sampleTriggered', index: this.currentSampleIndex });

// In main thread - listen for events
workletNode.port.onmessage = (e) => {
    if (e.data.type === 'sampleTriggered') {
        updatePlayingSample(e.data.index, sampleNames);
    }
};
```

#### 5. Sample Import with Replacement
```javascript
async function importSamples(files) {
    const newSamples = [];
    const newNames = [];
    for (const file of files) {
        const buffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(buffer);
        newSamples.push(audioBuffer.getChannelData(0));
        newNames.push(file.name);
    }
    // Replace existing samples
    sampleNames = newNames;
    workletNode.port.postMessage({
        type: 'loadSamples',
        samples: newSamples
    });
    buildSampleGrid(sampleNames);
}
```

#### 6. Standard HTML Structure
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>[Patch Name] - ER-301 Phonebook</title>
    <link rel="stylesheet" href="../../../styles.css">
</head>
<body class="patch-page">
    <header class="patch-header">
        <a href="../index.html" class="back-link">← Back</a>
        <div class="patch-info">
            <h1>[Patch Name]</h1>
            <p>[Brief description]</p>
        </div>
        <button class="info-toggle" id="infoToggle">ⓘ Info</button>
    </header>

    <div class="info-panel" id="infoPanel">
        <!-- Patch documentation -->
    </div>

    <main class="patch-content">
        <canvas id="visualizer"></canvas>

        <div class="controls">
            <button class="play-btn" id="playBtn">▶</button>
        </div>

        <div class="sample-visualizer">
            <div class="sample-grid" id="sampleGrid"></div>
            <div class="now-playing" id="nowPlaying">Ready</div>
        </div>

        <div class="param-controls">
            <!-- Patch-specific controls -->
        </div>

        <div class="sample-import">
            <input type="file" id="sampleInput" multiple accept="audio/*">
            <label for="sampleInput">Import Samples</label>
        </div>
    </main>

    <script>
        // AudioWorklet processor inline
        // Main thread initialization
        // Event handlers
    </script>
</body>
</html>
```

---

## Technical Challenges & Solutions

### Challenge 1: ER-301 DSP Translation
The ER-301 uses specific DSP units that need web equivalents:
- **Sine Osc with Feedback** → SinOscFB implementation
- **Band Limited Oscillators** → Polyblep or wavetable
- **Filter Delays** → Comb/allpass with feedback
- **Sloop** → Sample looper with granular features
- **Strike** → Physical modeling percussion

### Challenge 2: Sample Licensing
Some samples may have unclear licensing. Strategy:
- Use bundled samples for demonstration
- Allow users to substitute their own samples
- Document sample sources

### Challenge 3: Parameter Mapping
ER-301 has complex parameter modulation. Strategy:
- Map GainBias controls to range inputs
- Map Gate controls to buttons/toggles
- Map Pitch controls to note/octave selectors
- Preserve modulation routings where possible

### Challenge 4: Stereo Processing
Hyperscale units require stereo. Strategy:
- All processors output stereo by default
- Use `outputs[0][0]` and `outputs[0][1]` consistently
- Consider mid-side processing where appropriate

---

## Progress Log

### December 26, 2024 - Project Initialization
- Created project tracker
- Analyzed ER-301 .pkg structure
- Identified 108 total patches to convert
- Established folder structure plan
- Created shared utilities:
  - `lib/er301-sample-manager.js` - Sample loading and management
  - `lib/er301-info-panel.js` - Toggleable info panel component
  - `lib/er301-dsp.js` - Core DSP utilities (DelayLine, Biquad, Reverb, etc.)
- Implemented first patch: **bend** (Hyperscale)
  - Full signal chain: Variable Speed Player -> VCA -> Clocked Doppler Delay -> Dattorro Reverb -> CPR -> Limiter
  - 72 samples extracted and ready
  - All controls implemented
  - Info panel with documentation
- Integrated ER-301 patches into main index.html
- Added "coming soon" styling for pending patches

### December 26, 2024 - Sample Visualization
- Added sample visualization grid to bend patch:
  - Visual grid showing all loaded samples
  - Category badges (Kick, Hat, Clap, Tom, FX, Vox, Crash)
  - Real-time highlighting of currently playing sample
  - "Now Playing" indicator with sample name
  - Worklet-to-main-thread messaging for playback events
- Confirmed approach: All 108 patches, quality first

### December 26, 2024 - Bend Patch Refinements & Learnings
- **Dattorro Reverb Stability Issues**: Initial implementation caused runaway feedback
  - Root cause: Missing DC blockers, excessive decay, no output limiting
  - Solution: Added DCBlocker class, clamped decay to max 0.85, added tanh soft clipping
  - Reduced allpass coefficients from 0.75/0.625 to 0.7/0.5
  - Added input limiting before reverb processing
  - Key learning: Always include stability safeguards in reverb/delay algorithms

- **Vari-Speed Player Implementation**: Clarified that ER-301's Variable Speed Player does tape-style pitch shifting
  - Speed affects pitch (faster = higher pitch, slower = lower pitch)
  - Implemented linear interpolation for smooth fractional sample playback
  - Added randomized pitch distribution: 30% normal, 35% pitched up, 35% pitched down
  - Range: 0.25x (2 octaves down) to 2.0x (1 octave up)
  - Key learning: Check original ER-301 unit behavior before implementing

- **Sample Grid Size Issue**: Initial grid was thousands of pixels tall
  - Fixed with max-height: 120px and overflow-y: auto
  - Made slots compact (28x28px) with tooltip for full name
  - Key learning: Always constrain dynamic content size

- **Oscilloscope/Visualizer Sizing**: Was too large across all patches
  - Root cause: Using aspect-ratio instead of fixed height
  - Fixed in styles.css: Set explicit height: 150px for canvas elements
  - Key learning: Use fixed heights for visualizer elements, not aspect ratios

- **Sample Import Behavior**: Confirmed that importing new samples replaces existing ones
  - This is intentional - allows users to bring their own sample kit
  - Grid rebuilds automatically with new sample names
  - Worklet receives new sample data via port messaging

### Key DSP Components Validated in Bend Patch
1. **DelayLine** - Ring buffer with fractional delay support
2. **Biquad** - Standard biquad filter (LP, HP, BP, Notch)
3. **DCBlocker** - High-pass at ~20Hz to remove DC offset
4. **DattorroReverb** - Plate reverb with stability safeguards
5. **ClockedDopplerDelay** - Tempo-synced delay with pitch modulation
6. **Limiter** - Soft clipping limiter for output protection

### Patterns Established for Future Patches
- Self-contained HTML with inline AudioWorklet processor
- Worklet-to-main messaging for visualization updates
- Sample visualization grid with real-time playback indication
- Parameter controls mapped from ER-301 controlOrder
- Info panel with toggleable visibility
- Custom sample import replacing defaults

---

## Resources

### ER-301 Documentation
- [ER-301 Wiki](https://wiki.orthogonaldevices.com/)
- [ER-301 Hub](https://er301-hub.netlify.app)
- [Forum](https://forum.orthogonaldevices.com)

### Video Demos (Hyperscale)
- https://youtu.be/eztGpEXggFY
- https://youtu.be/FuTrYFDV6Zs
- https://youtu.be/Zbcc6PW59So

### Web Audio References
- [Web Audio API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [AudioWorklet MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
