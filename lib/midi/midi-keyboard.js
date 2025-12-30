// ============================================================================
// MIDI KEYBOARD
// Handle MIDI note input for synth patches
// ============================================================================

import { MidiManager } from './midi-manager.js';

class MidiKeyboard {
  constructor() {
    this.midiManager = null;
    this.workletNode = null;
    this.enabled = true;

    // Note state
    this.heldNotes = [];
    this.lastVelocity = 1;

    // Pitch bend range in semitones
    this.pitchBendRange = 2;
    this.currentPitchBend = 0;

    // Mod wheel (CC1)
    this.modWheelValue = 0;

    // Callbacks
    this.onNoteOn = null;
    this.onNoteOff = null;
    this.onPitchBend = null;
    this.onModWheel = null;

    this._unsubscribers = [];
  }

  async init(workletNode) {
    this.workletNode = workletNode;
    this.midiManager = await MidiManager.getInstance();

    if (!this.midiManager.isAvailable) {
      console.warn('MIDI Keyboard: MIDI not available');
      return false;
    }

    // Subscribe to note events
    this._unsubscribers.push(
      this.midiManager.onNote((data) => this._handleNote(data))
    );

    // Subscribe to pitch bend
    this._unsubscribers.push(
      this.midiManager.onPitchBend((data) => this._handlePitchBend(data))
    );

    // Subscribe to CC for mod wheel
    this._unsubscribers.push(
      this.midiManager.onCC((data) => {
        if (data.cc === 1) { // Mod wheel
          this._handleModWheel(data.normalized);
        }
      })
    );

    console.log('MIDI Keyboard initialized');
    return true;
  }

  _handleNote(data) {
    if (!this.enabled) return;

    const { type, note, velocity } = data;

    if (type === 'noteOn') {
      this._noteOn(note, velocity / 127);
    } else {
      this._noteOff(note);
    }
  }

  _noteOn(note, velocity) {
    // Add to held notes if not already there
    if (!this.heldNotes.includes(note)) {
      this.heldNotes.push(note);
    }

    this.lastVelocity = velocity;

    // Calculate frequency with pitch bend
    const frequency = this._noteToFrequency(note);

    // Send to worklet
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        midiNote: note,
        midiFrequency: frequency,
        midiVelocity: velocity,
        midiGate: true
      });
    }

    // Custom callback
    if (this.onNoteOn) {
      this.onNoteOn(note, velocity, frequency);
    }
  }

  _noteOff(note) {
    // Remove from held notes
    this.heldNotes = this.heldNotes.filter(n => n !== note);

    if (this.heldNotes.length === 0) {
      // All notes released
      if (this.workletNode) {
        this.workletNode.port.postMessage({
          midiGate: false
        });
      }

      if (this.onNoteOff) {
        this.onNoteOff(note);
      }
    } else {
      // Still holding notes - retrigger the last one (mono mode)
      const lastNote = this.heldNotes[this.heldNotes.length - 1];
      this._noteOn(lastNote, this.lastVelocity);
    }
  }

  _handlePitchBend(data) {
    if (!this.enabled) return;

    this.currentPitchBend = data.normalized * this.pitchBendRange;

    // Recalculate frequency for held notes
    if (this.heldNotes.length > 0 && this.workletNode) {
      const currentNote = this.heldNotes[this.heldNotes.length - 1];
      const frequency = this._noteToFrequency(currentNote);

      this.workletNode.port.postMessage({
        midiFrequency: frequency,
        midiPitchBend: data.normalized
      });
    }

    if (this.onPitchBend) {
      this.onPitchBend(data.normalized);
    }
  }

  _handleModWheel(value) {
    if (!this.enabled) return;

    this.modWheelValue = value;

    if (this.workletNode) {
      this.workletNode.port.postMessage({
        midiModWheel: value
      });
    }

    if (this.onModWheel) {
      this.onModWheel(value);
    }
  }

  _noteToFrequency(note) {
    // MIDI note to frequency with pitch bend
    const bendedNote = note + this.currentPitchBend;
    return 440 * Math.pow(2, (bendedNote - 69) / 12);
  }

  /**
   * Set the pitch bend range in semitones
   */
  setPitchBendRange(semitones) {
    this.pitchBendRange = semitones;
  }

  /**
   * Enable/disable keyboard input
   */
  setEnabled(enabled) {
    this.enabled = enabled;

    // If disabling, release all notes
    if (!enabled && this.heldNotes.length > 0) {
      this.heldNotes = [];
      if (this.workletNode) {
        this.workletNode.port.postMessage({ midiGate: false });
      }
    }
  }

  /**
   * Manually trigger a note (for virtual keyboard)
   */
  triggerNote(note, velocity = 1) {
    this._noteOn(note, velocity);
  }

  /**
   * Manually release a note (for virtual keyboard)
   */
  releaseNote(note) {
    this._noteOff(note);
  }

  /**
   * Release all notes
   */
  allNotesOff() {
    this.heldNotes = [];
    if (this.workletNode) {
      this.workletNode.port.postMessage({ midiGate: false });
    }
  }

  /**
   * Update worklet reference (e.g., after audio restart)
   */
  setWorkletNode(node) {
    this.workletNode = node;
  }

  /**
   * Cleanup
   */
  dispose() {
    this._unsubscribers.forEach(unsub => unsub());
    this._unsubscribers = [];
    this.allNotesOff();
  }
}

// Export for ES modules and global
if (typeof window !== 'undefined') {
  window.MidiKeyboard = MidiKeyboard;
}

export { MidiKeyboard };
