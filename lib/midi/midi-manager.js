// ============================================================================
// MIDI MANAGER
// Singleton for shared MIDI access across all features
// ============================================================================

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
    this.inputs = new Map();
    this.isAvailable = false;

    // Handler registries
    this.ccHandlers = [];
    this.noteHandlers = [];
    this.pitchBendHandlers = [];
    this.afterTouchHandlers = [];

    // Active input filter (null = all inputs)
    this.activeInputId = null;
  }

  async init() {
    if (!navigator.requestMIDIAccess) {
      console.warn('WebMIDI not supported in this browser');
      this.isAvailable = false;
      return false;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this.isAvailable = true;

      // Set up initial inputs
      this.midiAccess.inputs.forEach((input, id) => {
        this._connectInput(input, id);
      });

      // Listen for device changes
      this.midiAccess.onstatechange = (e) => {
        if (e.port.type === 'input') {
          if (e.port.state === 'connected') {
            this._connectInput(e.port, e.port.id);
          } else {
            this._disconnectInput(e.port.id);
          }
        }
      };

      console.log(`MIDI initialized with ${this.inputs.size} input(s)`);
      return true;
    } catch (e) {
      console.warn('MIDI access denied:', e);
      this.isAvailable = false;
      return false;
    }
  }

  _connectInput(input, id) {
    this.inputs.set(id, input);
    input.onmidimessage = (e) => this._routeMessage(e, id);
    console.log(`MIDI input connected: ${input.name}`);
  }

  _disconnectInput(id) {
    const input = this.inputs.get(id);
    if (input) {
      input.onmidimessage = null;
      this.inputs.delete(id);
      console.log(`MIDI input disconnected: ${input.name}`);
    }
  }

  _routeMessage(event, inputId) {
    // Filter by active input if set
    if (this.activeInputId && inputId !== this.activeInputId) return;

    const [status, data1, data2] = event.data;
    const channel = status & 0x0F;
    const command = status & 0xF0;

    switch (command) {
      case 0x80: // Note Off
        this.noteHandlers.forEach(h => h({
          type: 'noteOff',
          note: data1,
          velocity: data2,
          channel
        }));
        break;

      case 0x90: // Note On (velocity 0 = note off)
        this.noteHandlers.forEach(h => h({
          type: data2 > 0 ? 'noteOn' : 'noteOff',
          note: data1,
          velocity: data2,
          channel
        }));
        break;

      case 0xA0: // Polyphonic Aftertouch
        this.afterTouchHandlers.forEach(h => h({
          type: 'polyAT',
          note: data1,
          pressure: data2 / 127,
          channel
        }));
        break;

      case 0xB0: // Control Change
        this.ccHandlers.forEach(h => h({
          cc: data1,
          value: data2,
          normalized: data2 / 127,
          channel
        }));
        break;

      case 0xD0: // Channel Aftertouch
        this.afterTouchHandlers.forEach(h => h({
          type: 'channelAT',
          pressure: data1 / 127,
          channel
        }));
        break;

      case 0xE0: // Pitch Bend
        const bendValue = ((data2 << 7) | data1) - 8192;
        this.pitchBendHandlers.forEach(h => h({
          value: bendValue,
          normalized: bendValue / 8192, // -1 to +1
          channel
        }));
        break;
    }
  }

  // === Handler Registration ===

  onCC(handler) {
    this.ccHandlers.push(handler);
    return () => {
      const idx = this.ccHandlers.indexOf(handler);
      if (idx >= 0) this.ccHandlers.splice(idx, 1);
    };
  }

  onNote(handler) {
    this.noteHandlers.push(handler);
    return () => {
      const idx = this.noteHandlers.indexOf(handler);
      if (idx >= 0) this.noteHandlers.splice(idx, 1);
    };
  }

  onPitchBend(handler) {
    this.pitchBendHandlers.push(handler);
    return () => {
      const idx = this.pitchBendHandlers.indexOf(handler);
      if (idx >= 0) this.pitchBendHandlers.splice(idx, 1);
    };
  }

  onAfterTouch(handler) {
    this.afterTouchHandlers.push(handler);
    return () => {
      const idx = this.afterTouchHandlers.indexOf(handler);
      if (idx >= 0) this.afterTouchHandlers.splice(idx, 1);
    };
  }

  // === Utilities ===

  getInputList() {
    return Array.from(this.inputs.entries()).map(([id, input]) => ({
      id,
      name: input.name,
      manufacturer: input.manufacturer
    }));
  }

  setActiveInput(inputId) {
    this.activeInputId = inputId;
  }

  clearActiveInput() {
    this.activeInputId = null;
  }
}

// Export for ES modules and global
if (typeof window !== 'undefined') {
  window.MidiManager = MidiManager;
}

export { MidiManager };
