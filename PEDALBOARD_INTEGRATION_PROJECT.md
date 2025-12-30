# Pedalboard Integration Project: Advanced Effects Module

## Project Overview

Integrate 8 advanced modular-synth-inspired effects from `add_to_pedalboard/` into the main pedalboard FX chain system, allowing them to be used interchangeably with existing effects on any phonebook patch.

### Effects to Integrate

| Effect | Type | Hardware Inspiration | Complexity |
|--------|------|---------------------|------------|
| **Nautilus** | Multi-tap Delay | Instruo Nautilus | High |
| **Arbhar** | Granular Processor | Instruo Arbhar | Very High |
| **Morphagene** | Tape/Microsound | Make Noise Morphagene | Very High |
| **Lubadh** | Dual Tape Looper | Instruo Lubadh | High |
| **DataBender** | Glitch/Buffer | Qu-Bit Data Bender | High |
| **Mimeophon** | Stereo Delay | Make Noise Mimeophon | Medium |
| **Basil** | Delay (Send) | Custom | Medium |
| **FDNR** | Reverb (Send) | Feedback Delay Network | Medium |

---

## Architecture Analysis

### Current Pedalboard System

```
┌─────────────────────────────────────────────────────────────┐
│                    EFFECT CHAIN PROCESSOR                    │
│                   (AudioWorkletProcessor)                    │
├─────────────────────────────────────────────────────────────┤
│  Input → [Slot 0] → [Slot 1] → ... → [Slot 7] → Output     │
│              ↓          ↓                ↓                  │
│           Effect     Effect           Effect                │
│         (instance) (instance)       (instance)              │
└─────────────────────────────────────────────────────────────┘

Built-in Effects: All run INSIDE the effect-chain-processor worklet
- Each effect is a class with processStereo(inL, inR) → [outL, outR]
- Parameters set via message passing
- All DSP code bundled in single worklet
```

### Advanced Effects Architecture (add_to_pedalboard)

```
┌────────────────────────────────────────────────────────────┐
│                      MAIN THREAD                            │
│  ┌──────────────┐                                          │
│  │EffectNode.js │  Controls parameters, manages state      │
│  └──────┬───────┘                                          │
│         │ postMessage                                       │
├─────────▼──────────────────────────────────────────────────┤
│                    AUDIO WORKLET                            │
│  ┌──────────────────┐                                      │
│  │ effect-processor │  Actual DSP processing               │
│  └──────────────────┘                                      │
└────────────────────────────────────────────────────────────┘

Each advanced effect has:
- Separate worklet processor file
- Node class for control interface
- InputGain → Worklet → OutputGain routing
- Complex state (buffers, layers, grains, etc.)
```

### Integration Challenge

The key challenge is that:
1. **Built-in effects** run inside a single worklet (`effect-chain-processor`)
2. **Advanced effects** each have their own separate worklet

**Solution: Hybrid Architecture**

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENHANCED PEDALBOARD                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Input → [Slot 0] → [Slot 1] → [Slot 2] → ... → Output          │
│              ↓          ↓          ↓                             │
│           Built-in   External   Built-in                         │
│           Effect     Effect     Effect                           │
│              │          │          │                             │
│              ▼          ▼          ▼                             │
│         ┌────────┐ ┌────────┐ ┌────────┐                        │
│         │Internal│ │External│ │Internal│                        │
│         │Worklet │ │Worklet │ │Worklet │                        │
│         └────────┘ └────────┘ └────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Infrastructure (Foundation)

#### 1.1 Create Effect Wrapper Interface
Create a unified interface that can wrap both internal and external effects.

**Files to create:**
- `lib/effect-wrapper.js` - Base wrapper class

```javascript
// Pseudo-code structure
class EffectWrapper {
  constructor(type, audioContext)
  async initialize()
  connect(destination)
  disconnect()
  setParam(name, value)
  getParams()
  bypass(state)
  dispose()
}

class InternalEffectWrapper extends EffectWrapper {
  // Proxies to effect-chain-processor
}

class ExternalEffectWrapper extends EffectWrapper {
  // Wraps advanced effect nodes (Nautilus, Arbhar, etc.)
}
```

#### 1.2 Modify Effect Chain Processor
Update `effect-chain-processor.js` to support "passthrough" slots where audio routes to external worklets.

**Files to modify:**
- `lib/effect-chain-processor.js`

#### 1.3 Create Worklet Loader/Manager
Centralized module to handle loading multiple worklets on demand.

**Files to create:**
- `lib/worklet-manager.js`

```javascript
class WorkletManager {
  constructor(audioContext)
  async loadWorklet(name, url)
  isLoaded(name)
  getLoadedWorklets()
}
```

---

### Phase 2: Effect Adaptation

For each effect, create an adapter that conforms to the pedalboard interface.

#### 2.1 Nautilus Adapter
**Source:** `add_to_pedalboard/effects/nautilus/`

**Parameters to expose:**
| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| mix | 0-1 | 0.5 | Dry/wet |
| resolution | 0-1 | 0.4 | Delay time division |
| feedback | 0-1 | 0.5 | Repeat intensity |
| sensors | 1-8 | 1 | Active delay lines |
| dispersal | 0-1 | 0 | Line spacing |
| chroma | 0-5 | 0 | Feedback effect type |
| depth | 0-1 | 0 | Effect amount |
| reverbMix | 0-1 | 0 | End reverb |
| delayMode | select | fade | Mode selector |
| feedbackMode | select | normal | FB mode |

**Files to create:**
- `lib/effects/nautilus-adapter.js`

#### 2.2 Arbhar Adapter
**Source:** `add_to_pedalboard/effects/arbhar/`

**Parameters to expose:**
| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| mix | 0-1 | 0.5 | Dry/wet |
| scan | 0-1 | 0.5 | Buffer position |
| spray | 0-1 | 0 | Position randomness |
| intensity | 0-1 | 0.25 | Grain count |
| length | 0-1 | 0.3 | Grain duration |
| pitch | 0-1 | 0.5 | Grain pitch |
| pitchSpray | 0-1 | 0 | Pitch randomness |
| direction | 0-1 | 0.5 | Forward/reverse prob |
| reverbMix | 0-1 | 0 | Internal reverb |
| feedback | 0-1 | 0 | Feedback amount |
| scanMode | select | scan | Operating mode |

**Files to create:**
- `lib/effects/arbhar-adapter.js`

#### 2.3 Morphagene Adapter
**Source:** `add_to_pedalboard/effects/morphagene/`

**Parameters to expose:**
| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| mix | 0-1 | 1 | Dry/wet |
| varispeed | 0-1 | 0.75 | Speed/direction |
| geneSize | 0-1 | 0 | Grain window |
| slide | 0-1 | 0 | Position offset |
| morph | 0-1 | 0.3 | Overlap/layering |
| organize | 0-1 | 0 | Splice selection |
| sos | 0-1 | 1 | Sound on Sound mix |

**Files to create:**
- `lib/effects/morphagene-adapter.js`

#### 2.4 Lubadh Adapter
**Source:** `add_to_pedalboard/effects/lubadh/`

**Parameters to expose (simplified for pedalboard):**
| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| mix | 0-1 | 1 | Dry/wet |
| speedA | 0-1 | 0.75 | Deck A speed |
| speedB | 0-1 | 0.75 | Deck B speed |
| dubLevelA | 0-1 | 0.9 | Overdub feedback A |
| dubLevelB | 0-1 | 0.9 | Overdub feedback B |
| tapeEmulation | 0-1 | 0.5 | Tape character |
| wowFlutter | 0-1 | 0.3 | Pitch wobble |
| link | toggle | false | Link decks |

**Files to create:**
- `lib/effects/lubadh-adapter.js`

#### 2.5 DataBender Adapter
**Source:** `add_to_pedalboard/effects/databender/`

**Parameters to expose:**
| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| mix | 0-1 | 0.5 | Dry/wet |
| time | 0-1 | 0.5 | Buffer period |
| repeats | 0-1 | 0 | Subdivisions |
| bend | 0-1 | 0 | Bend amount/pitch |
| break | 0-1 | 0 | Break amount |
| corrupt | 0-1 | 0 | Corrupt amount |
| corruptType | select | decimate | Effect type |
| mode | select | macro | Macro/Micro mode |

**Files to create:**
- `lib/effects/databender-adapter.js`

#### 2.6 Mimeophon Adapter
**Source:** `add_to_pedalboard/mimeophon-standalone (1).js`

**Parameters to expose:**
| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| mix | 0-1 | 0.5 | Dry/wet |
| zone | 0-3 | 1 | Delay time zone |
| rate | 0-1 | 0.5 | Time within zone |
| microRate | 0-1 | 0 | Modulation amount |
| skew | -1 to 1 | 0 | L/R time offset |
| repeats | 0-1.2 | 0.3 | Feedback |
| color | 0-1 | 0.5 | Tone character |
| halo | 0-1 | 0 | Diffusion |
| hold | toggle | false | Freeze buffer |
| flip | toggle | false | Reverse |
| pingPong | toggle | false | Stereo bounce |

**Files to create:**
- `lib/effects/mimeophon-adapter.js`

#### 2.7 Basil Adapter (Send Effect)
**Source:** `add_to_pedalboard/effects/basil/`

**Files to create:**
- `lib/effects/basil-adapter.js`

#### 2.8 FDNR Adapter (Send Effect)
**Source:** `add_to_pedalboard/effects/fdnr/`

**Files to create:**
- `lib/effects/fdnr-adapter.js`

---

### Phase 3: UI Integration

#### 3.1 Update Effect Definitions
Add new effects to `effect-ui.js` effectDefs with proper categories.

**New Category: "Advanced"**
- Nautilus
- Arbhar
- Morphagene
- Lubadh
- DataBender
- Mimeophon

**New Category: "Send" (optional)**
- Basil
- FDNR

#### 3.2 Create Custom Parameter Controls
Some advanced effects need special UI components:
- Mode selectors with descriptions
- Toggle buttons (freeze, hold, flip)
- Visual feedback (grain activity, buffer position)

**Files to create/modify:**
- `lib/effect-ui.js` - Add new effect definitions
- `styles.css` - Add styling for new controls

#### 3.3 Effect Preset Integration
Allow saving/loading presets that include advanced effects.

---

### Phase 4: Audio Routing

#### 4.1 Chain Manager Updates
Update the pedalboard to handle mixed effect types in the chain.

**Logic flow:**
```
For each slot in chain:
  if (slot.effectType is internal):
    route through effect-chain-processor
  else if (slot.effectType is external):
    route audio out to external worklet
    receive audio back from external worklet
    continue chain
```

#### 4.2 Send/Return Bus (Optional)
For Basil and FDNR, implement send/return architecture:
```
Main Chain → Send Amount → Send Bus → [Basil/FDNR] → Return Mix → Output
```

---

### Phase 5: Testing & Polish

#### 5.1 Individual Effect Tests
- Each effect sounds correct
- Parameters respond properly
- Bypass works
- No audio glitches on add/remove

#### 5.2 Chain Integration Tests
- Effects can be reordered
- Multiple external effects work together
- CPU usage acceptable
- State saves/loads correctly

#### 5.3 Performance Optimization
- Lazy-load worklets (only when effect is added)
- Dispose worklets when effect removed
- Optimize message passing

---

## File Structure (Proposed)

```
lib/
├── pedalboard-effects.js      (existing - internal effects)
├── effect-chain-processor.js  (existing - modify)
├── effect-ui.js               (existing - modify)
├── effect-wrapper.js          (new - unified interface)
├── worklet-manager.js         (new - worklet loading)
└── effects/
    ├── nautilus-adapter.js    (new)
    ├── arbhar-adapter.js      (new)
    ├── morphagene-adapter.js  (new)
    ├── lubadh-adapter.js      (new)
    ├── databender-adapter.js  (new)
    ├── mimeophon-adapter.js   (new)
    ├── basil-adapter.js       (new)
    └── fdnr-adapter.js        (new)

add_to_pedalboard/
├── effects/                   (existing - source effects)
│   ├── nautilus/
│   ├── arbhar/
│   ├── morphagene/
│   ├── lubadh/
│   ├── databender/
│   ├── basil/
│   └── fdnr/
└── worklets/                  (existing - worklet processors)
```

---

## Progress Tracker

### Phase 1: Infrastructure
- [x] 1.1 Create EffectWrapper base class (`lib/effect-wrapper.js`)
- [x] 1.2 Create InternalEffectWrapper
- [x] 1.3 Create ExternalEffectWrapper
- [x] 1.4 Modify effect-ui.js for external effect routing
- [x] 1.5 Create WorkletManager (`lib/worklet-manager.js`)

### Phase 2: Effect Adapters
- [x] 2.1 Nautilus adapter (`lib/effects/nautilus-adapter.js`)
- [x] 2.2 Arbhar adapter (`lib/effects/arbhar-adapter.js`)
- [x] 2.3 Morphagene adapter (`lib/effects/morphagene-adapter.js`)
- [x] 2.4 Lubadh adapter (`lib/effects/lubadh-adapter.js`)
- [x] 2.5 DataBender adapter (`lib/effects/databender-adapter.js`)
- [x] 2.6 Mimeophon adapter (`lib/effects/mimeophon-adapter.js`)
- [x] 2.7 Basil adapter (`lib/effects/basil-adapter.js`)
- [x] 2.8 FDNR adapter (`lib/effects/fdnr-adapter.js`)

### Phase 3: UI Integration
- [x] 3.1 Add effect definitions to effect-ui.js (All 8 effects added)
- [ ] 3.2 Create custom parameter controls
- [x] 3.3 Add "Advanced" category (All 8 effects included)
- [ ] 3.4 Style new UI elements
- [ ] 3.5 Preset integration

### Phase 4: Audio Routing
- [x] 4.1 Update chain manager (`connectExternalEffects()`)
- [x] 4.2 Implement external effect routing
- [ ] 4.3 Send/return bus (optional)

### Phase 5: Testing
- [ ] 5.1 Individual effect tests
- [ ] 5.2 Chain integration tests
- [ ] 5.3 Performance optimization
- [ ] 5.4 Cross-browser testing

---

## Technical Notes

### Worklet Loading Strategy
```javascript
// Load worklets on-demand when effect is first added
async function addExternalEffect(slot, type) {
  if (!workletManager.isLoaded(type)) {
    await workletManager.loadWorklet(type, `/worklets/${type}-processor.js`);
  }
  // Create effect instance
}
```

### Message Passing Pattern
```javascript
// Unified parameter interface
setParam(name, value) {
  if (this.isExternal) {
    this.node.setParam(name, value);
  } else {
    this.workletPort.postMessage({
      action: 'setParam',
      slot: this.slot,
      param: name,
      value: value
    });
  }
}
```

### Audio Routing for External Effects
```javascript
// Connect external effect in chain
connectExternalEffect(prevNode, effectNode, nextNode) {
  prevNode.disconnect();
  prevNode.connect(effectNode.input);
  effectNode.connect(nextNode);
}
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Audio glitches when switching effects | High | Use crossfade when adding/removing |
| High CPU with multiple external worklets | Medium | Lazy loading, dispose unused |
| Complex UI for advanced effects | Medium | Start with essential params only |
| Message latency between worklets | Low | Batch parameter updates |
| Browser compatibility | Medium | Test Safari, Firefox, Chrome |

---

## Success Criteria

1. **Sound Fidelity**: Effects sound identical to standalone versions
2. **Seamless Integration**: Add/remove/reorder works smoothly
3. **Parameter Control**: All essential parameters accessible via UI
4. **Performance**: No noticeable latency or CPU spikes
5. **Presets**: Can save/load chains with advanced effects
6. **Stability**: No crashes or audio dropouts

---

## Dependencies

- Web Audio API (AudioWorklet support)
- Existing pedalboard infrastructure
- Effect source files from add_to_pedalboard/

---

## Notes

- Start with Mimeophon (simplest, self-contained)
- Arbhar and Morphagene are most complex (sample loading, recording)
- Consider simplified parameter sets for pedalboard vs full standalone UI
- May need to adjust worklet paths for production deployment
