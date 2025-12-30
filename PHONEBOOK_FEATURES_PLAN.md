# Phonebook Features Implementation Plan

## Overview

This document outlines the implementation plan for four major features:
1. **WAV Recorder** - Record jams with auto-naming
2. **MIDI Learn** - Assign any parameter to MIDI CC
3. **MIDI Keyboard Input** - Play synths with MIDI keyboards
4. **Modulation Matrix** - 6 mod sources with flexible routing

---

## Feature 1: WAV Recorder

### Requirements
- Sticky header on every patch page
- Record button with visual feedback
- Auto-generated filename: `{patch-name}_{key}_{scale}_{bpm}_{timestamp}.wav`
- Download WAV file when stopped

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ STICKY HEADER                                               │
│ ┌─────────────┐ ┌──────────┐ ┌──────────────────────────┐  │
│ │ ● REC       │ │ 00:00:00 │ │ patch-01_Cmaj_120bpm... │  │
│ └─────────────┘ └──────────┘ └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

**New Files:**
- `lib/wav-recorder.js` - Recording logic and WAV encoding

**Key Components:**
```javascript
class WavRecorder {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.mediaRecorder = null;
    this.chunks = [];
    this.isRecording = false;
    this.startTime = null;

    // Create MediaStreamDestination for recording
    this.dest = audioContext.createMediaStreamDestination();

    // ScriptProcessor or AudioWorklet for WAV capture
    this.recorder = new AudioWorkletNode(audioContext, 'wav-recorder-processor');
  }

  start() { ... }
  stop() { ... }  // Returns WAV blob
  getFilename(patchInfo) { ... }
}
```

**WAV Encoding Options:**

Option A: MediaRecorder API (simpler, but produces WebM/Opus)
- Pros: Built-in, simple API
- Cons: Browser-dependent format, not always WAV

Option B: Manual WAV encoding via AudioWorklet (recommended)
- Pros: Guaranteed WAV format, 44.1kHz/16-bit or 48kHz/32-bit
- Cons: More code, need to handle large buffers

**Recommendation:** Option B - Use AudioWorklet to capture raw PCM samples, then encode to WAV on stop.

### Files to Modify
- All 37+ patch HTML files (add sticky header div and recorder init)
- `styles.css` (add sticky header styles)

### Effort Estimate
- Core recorder class: Medium
- WAV encoder: Medium
- UI integration across patches: Medium (repetitive)
- Total: ~4-6 hours

---

## Feature 2: MIDI Learn

### Requirements
- Any slider/parameter can be assigned to MIDI CC
- Works on patch parameters AND pedalboard controls
- Visual indication of MIDI-mapped parameters
- Persistent mappings (localStorage per patch)
- "MIDI Learn" mode toggle

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ MIDI LEARN SYSTEM                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MidiLearnManager                                           │
│  ├── midiAccess (WebMIDI API)                              │
│  ├── learningTarget: null | { element, param, callback }   │
│  ├── mappings: Map<ccNumber, { param, min, max, callback }> │
│  └── onMidiMessage(event) → route to mapped callbacks      │
│                                                             │
│  UI Integration:                                            │
│  ├── Right-click on any slider → "MIDI Learn" context menu │
│  ├── Learning mode indicator (pulsing border)              │
│  ├── Mapped indicator (colored dot/ring)                   │
│  └── Clear mapping option                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

**New Files:**
- `lib/midi-learn.js` - MIDI Learn manager class

**Key Code:**
```javascript
class MidiLearnManager {
  constructor() {
    this.mappings = new Map(); // CC# -> { param, element, min, max, callback }
    this.learningTarget = null;
    this.midiAccess = null;
  }

  async init() {
    this.midiAccess = await navigator.requestMIDIAccess();
    this.midiAccess.inputs.forEach(input => {
      input.onmidimessage = this.handleMidiMessage.bind(this);
    });
  }

  startLearning(element, param, min, max, callback) {
    this.learningTarget = { element, param, min, max, callback };
    element.classList.add('midi-learning');
  }

  handleMidiMessage(event) {
    const [status, cc, value] = event.data;
    if ((status & 0xF0) !== 0xB0) return; // Only CC messages

    if (this.learningTarget) {
      // Assign this CC to the learning target
      this.mappings.set(cc, this.learningTarget);
      this.learningTarget.element.classList.remove('midi-learning');
      this.learningTarget.element.classList.add('midi-mapped');
      this.learningTarget = null;
      this.saveMappings();
      return;
    }

    // Route to mapped parameter
    const mapping = this.mappings.get(cc);
    if (mapping) {
      const normalized = value / 127;
      const scaledValue = mapping.min + normalized * (mapping.max - mapping.min);
      mapping.callback(scaledValue);
      mapping.element.value = scaledValue;
      // Trigger input event for UI update
      mapping.element.dispatchEvent(new Event('input'));
    }
  }

  saveMappings() { /* localStorage */ }
  loadMappings() { /* localStorage */ }
}
```

### UI Integration Pattern
```javascript
// For each slider in patch
slider.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  midiLearn.startLearning(
    slider,
    slider.id,
    parseFloat(slider.min),
    parseFloat(slider.max),
    (value) => {
      // Send to worklet or pedalboard
      workletNode?.port.postMessage({ [slider.id]: value });
    }
  );
});
```

### Pedalboard Integration
Modify `effect-ui.js` to expose slider elements for MIDI Learn:
```javascript
// In bindEvents() after creating sliders
slider.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.midiLearn?.startLearning(
    slider,
    `${slotIndex}_${param}`,
    parseFloat(slider.min),
    parseFloat(slider.max),
    (value) => this.setParam(slotIndex, param, value)
  );
});
```

### Effort Estimate
- MIDI Learn manager: Medium
- UI context menu integration: Low
- Pedalboard integration: Low
- Persistence: Low
- Total: ~3-4 hours

---

## Feature 3: MIDI Keyboard Input

### Requirements
- Synth patches respond to MIDI note on/off
- Velocity sensitivity
- Optional: pitch bend, mod wheel
- Only applies to patches with pitched synthesis

### Applicable Patches
Patches with pitch control that would benefit from MIDI input:
- patch-01-rlpf-pulse.html (has quantizer)
- patch-13-lpf-delay-feedback.html (has quantizer)
- Any patch with frequency/pitch parameter
- Blippoo, Ciat-Lonbarde style patches

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ MIDI KEYBOARD SYSTEM                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MidiKeyboardManager                                        │
│  ├── noteOn(note, velocity) → send pitch to worklet        │
│  ├── noteOff(note) → optional gate off                     │
│  ├── pitchBend(value) → fine pitch adjustment              │
│  └── modWheel(value) → assignable modulation               │
│                                                             │
│  Worklet Integration:                                       │
│  ├── midiPitch: MIDI note number (0-127)                   │
│  ├── midiVelocity: 0-1 normalized                          │
│  ├── midiGate: boolean                                     │
│  └── Convert note to frequency: 440 * 2^((note-69)/12)     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

This can be part of `midi-learn.js` or a separate `midi-keyboard.js`:

```javascript
class MidiKeyboardManager {
  constructor(workletNode) {
    this.workletNode = workletNode;
    this.heldNotes = [];
    this.enabled = true;
  }

  handleMidiMessage(event) {
    const [status, note, velocity] = event.data;
    const channel = status & 0x0F;
    const command = status & 0xF0;

    switch (command) {
      case 0x90: // Note On
        if (velocity > 0) {
          this.noteOn(note, velocity / 127);
        } else {
          this.noteOff(note);
        }
        break;
      case 0x80: // Note Off
        this.noteOff(note);
        break;
      case 0xE0: // Pitch Bend
        const bend = ((velocity << 7) | note) - 8192;
        this.pitchBend(bend / 8192); // -1 to +1
        break;
      case 0xB0: // CC
        if (note === 1) this.modWheel(velocity / 127);
        break;
    }
  }

  noteOn(note, velocity) {
    const frequency = 440 * Math.pow(2, (note - 69) / 12);
    this.heldNotes.push(note);
    this.workletNode?.port.postMessage({
      midiNote: note,
      midiFrequency: frequency,
      midiVelocity: velocity,
      midiGate: true
    });
  }

  noteOff(note) {
    this.heldNotes = this.heldNotes.filter(n => n !== note);
    if (this.heldNotes.length === 0) {
      this.workletNode?.port.postMessage({ midiGate: false });
    } else {
      // Retrigger last held note (for mono synths)
      const lastNote = this.heldNotes[this.heldNotes.length - 1];
      this.noteOn(lastNote, 1);
    }
  }
}
```

### Worklet Integration
Patches need to handle `midiFrequency` message:
```javascript
// In worklet processor
this.port.onmessage = (e) => {
  if (e.data.midiFrequency !== undefined) {
    this.baseFrequency = e.data.midiFrequency;
  }
  if (e.data.midiGate !== undefined) {
    this.gate = e.data.midiGate;
  }
  // ... existing param handlers
};
```

### Effort Estimate
- MIDI keyboard manager: Low
- Worklet modifications (per patch): Low-Medium (varies by patch)
- Total: ~2-3 hours

---

## Feature 4: Modulation Matrix (6 Sources, 2 Destinations Each)

### Requirements
- 6 independent modulation sources
- Each source has 2 destination slots
- Depth control per destination
- LFO shapes: Sine, Triangle, Square, Saw Up, Saw Down, Sample & Hold (Random)
- 12 complex envelope shapes
- Rate, phase, polarity, smoothness controls
- Can modulate ANY parameter including other mod sources
- Can modulate pedalboard controls

### This is the most complex feature.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ MODULATION MATRIX                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ MOD SOURCE 1                                             │   │
│  │ ┌─────────┐ ┌──────┐ ┌───────┐ ┌───────┐ ┌──────────┐   │   │
│  │ │ Shape ▼ │ │ Rate │ │ Phase │ │ Polar │ │ Smooth   │   │   │
│  │ │  Sine   │ │ 0.5Hz│ │  0°   │ │ Unip  │ │  0.1     │   │   │
│  │ └─────────┘ └──────┘ └───────┘ └───────┘ └──────────┘   │   │
│  │                                                          │   │
│  │ Dest 1: [Filter Cutoff ▼]  Depth: [━━━━━●━━━] 50%       │   │
│  │ Dest 2: [LFO 2 Rate    ▼]  Depth: [━━●━━━━━━] 25%       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ MOD SOURCE 2                                             │   │
│  │ ...                                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ... (6 total sources)                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### LFO Shapes (6)
1. **Sine** - Smooth oscillation
2. **Triangle** - Linear up/down
3. **Square** - Binary on/off
4. **Saw Up** - Ramp up, instant reset
5. **Saw Down** - Instant up, ramp down
6. **Sample & Hold** - Random steps

### Envelope Shapes (12 Complex)
1. **AD** - Attack-Decay
2. **AR** - Attack-Release (sustained)
3. **ASR** - Attack-Sustain-Release
4. **ADSR** - Classic envelope
5. **AHD** - Attack-Hold-Decay
6. **AHDSR** - With hold stage
7. **Multi-stage Decay** - Multiple decay slopes
8. **Exponential AD** - Sharp attack, long tail
9. **Logarithmic AD** - Slow attack, quick decay
10. **Bounce** - Multiple peaks during decay
11. **Pluck** - Very fast attack, medium decay
12. **Swell** - Slow attack, instant release (reverse)

### Implementation Strategy

**New Files:**
- `lib/modulation-matrix.js` - Core modulation engine
- `lib/mod-matrix-ui.js` - UI components
- `lib/mod-shapes.js` - LFO and envelope generators

**Core Classes:**

```javascript
// mod-shapes.js
class LFOGenerator {
  constructor() {
    this.phase = 0;
    this.rate = 1;      // Hz
    this.shape = 'sine';
    this.polarity = 'bipolar'; // 'bipolar' (-1 to 1) or 'unipolar' (0 to 1)
    this.smoothing = 0; // Low-pass filter amount
    this.lastValue = 0;
  }

  tick(dt) {
    this.phase += this.rate * dt;
    if (this.phase >= 1) this.phase -= 1;

    let value = this.getShapeValue(this.phase);

    // Apply polarity
    if (this.polarity === 'unipolar') {
      value = (value + 1) / 2;
    }

    // Apply smoothing (one-pole filter)
    value = this.lastValue + (value - this.lastValue) * (1 - this.smoothing);
    this.lastValue = value;

    return value;
  }

  getShapeValue(phase) {
    switch (this.shape) {
      case 'sine':
        return Math.sin(phase * Math.PI * 2);
      case 'triangle':
        return phase < 0.5 ? (phase * 4 - 1) : (3 - phase * 4);
      case 'square':
        return phase < 0.5 ? 1 : -1;
      case 'sawUp':
        return phase * 2 - 1;
      case 'sawDown':
        return 1 - phase * 2;
      case 'random':
        // Sample & hold - only change on phase wrap
        if (phase < this.lastPhase) {
          this.randomValue = Math.random() * 2 - 1;
        }
        this.lastPhase = phase;
        return this.randomValue;
    }
  }
}

class EnvelopeGenerator {
  constructor() {
    this.shape = 'adsr';
    this.stages = { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 };
    this.phase = 0;
    this.stage = 'idle'; // idle, attack, decay, sustain, release
    this.value = 0;
  }

  trigger() { this.stage = 'attack'; this.value = 0; }
  release() { this.stage = 'release'; }

  tick(dt) {
    // State machine for envelope stages
    // Returns 0-1 value
  }
}
```

**Modulation Matrix Manager:**
```javascript
// modulation-matrix.js
class ModulationMatrix {
  constructor() {
    this.sources = [];
    for (let i = 0; i < 6; i++) {
      this.sources.push({
        generator: new LFOGenerator(),
        destinations: [
          { target: null, depth: 0 },
          { target: null, depth: 0 }
        ]
      });
    }

    this.parameterRegistry = new Map(); // name -> { getValue, setValue, min, max }
  }

  registerParameter(name, config) {
    this.parameterRegistry.set(name, config);
  }

  tick(dt) {
    // Calculate all mod source values
    const modValues = this.sources.map(s => s.generator.tick(dt));

    // Apply modulation to destinations
    this.sources.forEach((source, i) => {
      const modValue = modValues[i];

      source.destinations.forEach(dest => {
        if (!dest.target) return;

        const param = this.parameterRegistry.get(dest.target);
        if (!param) return;

        const baseValue = param.getBaseValue();
        const range = param.max - param.min;
        const modAmount = modValue * dest.depth * range;
        const newValue = Math.max(param.min, Math.min(param.max, baseValue + modAmount));

        param.setValue(newValue);
      });
    });
  }

  getDestinationOptions() {
    // Return list of all registered parameters
    // Including other mod sources (for mod-of-mod)
    return Array.from(this.parameterRegistry.keys());
  }
}
```

### Integration with Existing Parameters

**Challenge:** Parameters are currently set directly. We need a "base value" concept.

**Solution:** Parameter wrapper that tracks base vs. modulated value:
```javascript
class ModulatableParameter {
  constructor(name, min, max, defaultValue, onChange) {
    this.name = name;
    this.min = min;
    this.max = max;
    this.baseValue = defaultValue;
    this.modulatedValue = defaultValue;
    this.onChange = onChange;
  }

  setBase(value) {
    this.baseValue = value;
    this.modulatedValue = value; // Will be overwritten by mod matrix
    this.onChange(this.modulatedValue);
  }

  applyModulation(modAmount) {
    this.modulatedValue = Math.max(this.min,
      Math.min(this.max, this.baseValue + modAmount));
    this.onChange(this.modulatedValue);
  }
}
```

### Running the Modulation Matrix

**Option A: Main thread (simpler but less accurate)**
```javascript
// In patch, after audio starts
function runModMatrix() {
  modMatrix.tick(1/60); // 60fps update rate
  requestAnimationFrame(runModMatrix);
}
```

**Option B: AudioWorklet (accurate but complex)**
- Run mod matrix inside the processor
- Requires all mod state to be in worklet
- Best for sample-accurate modulation

**Recommendation:** Start with Option A for most parameters, Option B for critical audio-rate modulation.

### Pedalboard Integration

Register pedalboard parameters with mod matrix:
```javascript
// In effect-ui.js, after adding effect
Object.entries(def.params).forEach(([param, config]) => {
  modMatrix.registerParameter(`slot${slotIndex}_${param}`, {
    min: config.min,
    max: config.max,
    getBaseValue: () => this.slots[slotIndex].params[param],
    setValue: (v) => this.setParam(slotIndex, param, v)
  });
});
```

### UI Considerations

The mod matrix UI could be:
1. **Collapsible panel** at bottom of every patch
2. **Overlay/modal** triggered by button
3. **Separate section** after param controls

**Recommendation:** Collapsible panel, starts collapsed, expands to show 6 mod sources.

### Effort Estimate
- LFO generator: Low
- Envelope generator: Medium (12 shapes)
- Mod matrix core: Medium
- Parameter registration system: Medium
- UI components: Medium-High
- Integration across patches: High (needs per-patch registration)
- Total: ~8-12 hours

---

## Implementation Order

### Recommended Sequence:

1. **MIDI Learn** (simplest, standalone)
   - Low risk, high utility
   - Sets up MIDI infrastructure for keyboard input

2. **MIDI Keyboard Input**
   - Builds on MIDI infrastructure
   - Straightforward per-patch modifications

3. **WAV Recorder**
   - Standalone feature
   - Requires sticky header across all patches

4. **Modulation Matrix**
   - Most complex
   - Benefits from stable MIDI and recorder features

---

## Shared Infrastructure

### Common MIDI Manager

Create unified MIDI access:
```javascript
// lib/midi-manager.js
class MidiManager {
  static instance = null;

  static async getInstance() {
    if (!MidiManager.instance) {
      MidiManager.instance = new MidiManager();
      await MidiManager.instance.init();
    }
    return MidiManager.instance;
  }

  constructor() {
    this.midiAccess = null;
    this.handlers = {
      cc: [],      // MIDI Learn handlers
      note: [],    // Keyboard handlers
      pitchBend: [],
      clock: []
    };
  }

  async init() {
    try {
      this.midiAccess = await navigator.requestMIDIAccess();
      this.midiAccess.inputs.forEach(input => {
        input.onmidimessage = this.routeMessage.bind(this);
      });
    } catch (e) {
      console.warn('MIDI not available:', e);
    }
  }

  routeMessage(event) {
    const [status, d1, d2] = event.data;
    const command = status & 0xF0;

    switch (command) {
      case 0xB0: // CC
        this.handlers.cc.forEach(h => h(d1, d2));
        break;
      case 0x90: // Note On
      case 0x80: // Note Off
        this.handlers.note.forEach(h => h(command, d1, d2));
        break;
      case 0xE0: // Pitch Bend
        const bend = ((d2 << 7) | d1) - 8192;
        this.handlers.pitchBend.forEach(h => h(bend / 8192));
        break;
    }
  }

  onCC(handler) { this.handlers.cc.push(handler); }
  onNote(handler) { this.handlers.note.push(handler); }
  onPitchBend(handler) { this.handlers.pitchBend.push(handler); }
}
```

### Sticky Header Component

Shared header for all patches:
```javascript
// lib/sticky-header.js
class StickyHeader {
  constructor(container, patchInfo) {
    this.container = container;
    this.patchInfo = patchInfo; // { name, key, scale, bpm }
    this.recorder = null;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="sticky-header">
        <button class="record-btn" id="recordBtn">
          <span class="record-dot"></span> REC
        </button>
        <span class="record-time" id="recordTime">00:00:00</span>
        <span class="record-filename" id="recordFilename"></span>
        <button class="midi-learn-toggle" id="midiLearnToggle">MIDI Learn</button>
      </div>
    `;
    this.bindEvents();
  }

  bindEvents() { ... }
}
```

---

## File Structure After Implementation

```
lib/
├── effect-ui.js           (existing, modified for mod matrix & MIDI)
├── effect-wrapper.js      (existing)
├── pedalboard-effects.js  (existing)
├── midi/
│   ├── midi-manager.js    (shared MIDI access)
│   ├── midi-learn.js      (CC mapping)
│   └── midi-keyboard.js   (note input)
├── modulation/
│   ├── mod-matrix.js      (core modulation engine)
│   ├── mod-shapes.js      (LFO & envelope generators)
│   └── mod-matrix-ui.js   (UI components)
├── recording/
│   ├── wav-recorder.js    (audio capture)
│   └── wav-encoder.js     (PCM to WAV conversion)
└── sticky-header.js       (shared header component)
```

---

## Testing Strategy

1. **Unit tests** for mod shapes (LFO, envelopes)
2. **Integration test** for MIDI routing
3. **Manual testing** of recorder across browsers
4. **Latency testing** for mod matrix at different update rates

---

## Browser Compatibility

- **WebMIDI:** Chrome, Edge, Opera (not Firefox/Safari without polyfill)
- **AudioWorklet:** All modern browsers
- **MediaRecorder:** All modern browsers (format varies)

Consider adding feature detection and graceful degradation.

---

## Questions for Clarification

1. **Mod Matrix Rate Range:** What is "very slow to very fast"?
   - Suggestion: 0.01 Hz to 100 Hz (covers 100-second cycles to audio rate)

2. **Envelope Triggers:** How should envelopes be triggered?
   - Options: MIDI note, manual button, LFO threshold, audio input level

3. **Mod-of-Mod Depth:** Can mod sources modulate the depth of other mod destinations, or just the rate?

4. **Preset Saving:** Should mod matrix settings be included in patch presets?

5. **Visual Feedback:** Should mod sources have visual waveform displays?

---

## Summary

| Feature | Complexity | Dependencies | Est. Hours |
|---------|------------|--------------|------------|
| WAV Recorder | Medium | None | 4-6 |
| MIDI Learn | Low-Medium | WebMIDI | 3-4 |
| MIDI Keyboard | Low | MIDI Learn | 2-3 |
| Mod Matrix | High | Param system | 8-12 |
| **Total** | | | **17-25** |

Ready to begin implementation when approved.
