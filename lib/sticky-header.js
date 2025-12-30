// ============================================================================
// STICKY HEADER
// Unified header component for all patches with recording and MIDI controls
// ============================================================================

import { WavRecorder } from './recording/wav-recorder.js';
import { getMidiLearn } from './midi/midi-learn.js';

class StickyHeader {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.audioContext = options.audioContext;
    this.patchInfo = {
      name: options.patchName || 'recording',
      key: options.key || null,
      scale: options.scale || null,
      bpm: options.bpm || null
    };
    this.patchId = options.patchId || 'default';

    this.recorder = null;
    this.midiLearn = null;
    this.isRecording = false;
    this.isMidiLearnMode = false;

    this.headerEl = null;
  }

  async init() {
    // Create header element
    this._createHeader();

    // Initialize MIDI Learn
    this.midiLearn = await getMidiLearn(this.patchId);

    return this;
  }

  /**
   * Initialize recorder (call after audio context is ready)
   */
  async initRecorder(audioContext, sourceNode, destinationNode) {
    this.audioContext = audioContext;

    this.recorder = new WavRecorder(audioContext);
    await this.recorder.init();

    // Set patch info
    this.recorder.setPatchInfo(this.patchInfo);

    // Connect: source -> recorder -> destination
    // The recorder passes through audio
    if (sourceNode && destinationNode) {
      sourceNode.connect(this.recorder.node);
      this.recorder.node.connect(destinationNode);
    }

    // Set up callbacks
    this.recorder.onTimeUpdate = (seconds) => {
      this._updateTime(seconds);
    };

    this.recorder.onStop = (blob, filename) => {
      // Auto-download
      WavRecorder.download(blob, filename);
      this._updateFilename(filename);
    };

    return this.recorder.node;
  }

  /**
   * Get recorder node to insert in audio chain manually
   */
  getRecorderNode() {
    return this.recorder?.node;
  }

  _createHeader() {
    // Create sticky header
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'sticky-header';
    this.headerEl.innerHTML = `
      <div class="sticky-header-content">
        <div class="header-section recording-section">
          <button class="record-btn" id="stickyRecordBtn" title="Record (R)">
            <span class="record-dot"></span>
            <span class="record-label">REC</span>
          </button>
          <span class="record-time" id="stickyRecordTime">0:00</span>
          <span class="record-filename" id="stickyRecordFilename"></span>
        </div>

        <div class="header-section midi-section">
          <button class="midi-learn-btn" id="stickyMidiLearnBtn" title="MIDI Learn Mode (M)">
            MIDI
          </button>
          <span class="midi-status" id="stickyMidiStatus"></span>
        </div>
      </div>
    `;

    // Insert at top of body or container
    if (this.container === document.body) {
      document.body.insertBefore(this.headerEl, document.body.firstChild);
    } else {
      this.container.insertBefore(this.headerEl, this.container.firstChild);
    }

    this._bindEvents();
  }

  _bindEvents() {
    // Record button
    const recordBtn = this.headerEl.querySelector('#stickyRecordBtn');
    recordBtn.addEventListener('click', () => this._toggleRecording());

    // MIDI Learn button
    const midiBtn = this.headerEl.querySelector('#stickyMidiLearnBtn');
    midiBtn.addEventListener('click', () => this._toggleMidiLearn());

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Don't trigger if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'r' || e.key === 'R') {
        this._toggleRecording();
      } else if (e.key === 'm' || e.key === 'M') {
        this._toggleMidiLearn();
      } else if (e.key === 'Escape' && this.isMidiLearnMode) {
        this._toggleMidiLearn();
      }
    });

    // Listen for MIDI Learn events
    window.addEventListener('midi-learn-start', () => {
      this._updateMidiStatus('Move a MIDI controller...');
    });

    window.addEventListener('midi-learn-complete', (e) => {
      this._updateMidiStatus(`CC${e.detail.cc} assigned`);
      setTimeout(() => this._updateMidiStatus(''), 2000);
    });

    window.addEventListener('midi-learn-cancel', () => {
      this._updateMidiStatus('');
    });
  }

  _toggleRecording() {
    if (!this.recorder) {
      console.warn('Recorder not initialized. Start audio first.');
      return;
    }

    const recordBtn = this.headerEl.querySelector('#stickyRecordBtn');

    if (this.isRecording) {
      // Stop recording
      this.recorder.stop();
      this.isRecording = false;
      recordBtn.classList.remove('active');
      this._updateTime(0);
    } else {
      // Start recording
      this.recorder.start();
      this.isRecording = true;
      recordBtn.classList.add('active');
      this._updateFilename('');
    }
  }

  _toggleMidiLearn() {
    const midiBtn = this.headerEl.querySelector('#stickyMidiLearnBtn');

    if (this.isMidiLearnMode) {
      // Exit MIDI Learn mode
      this.isMidiLearnMode = false;
      midiBtn.classList.remove('active');
      document.body.classList.remove('midi-learn-mode');
      this._updateMidiStatus('');

      // Tell MidiLearn to exit mode
      if (this.midiLearn) {
        this.midiLearn.setMidiLearnMode(false);
      }
    } else {
      // Enter MIDI Learn mode
      this.isMidiLearnMode = true;
      midiBtn.classList.add('active');
      document.body.classList.add('midi-learn-mode');
      this._updateMidiStatus('Click a slider to assign');

      // Tell MidiLearn to enter mode
      if (this.midiLearn) {
        this.midiLearn.setMidiLearnMode(true);
      }
    }
  }

  _updateTime(seconds) {
    const timeEl = this.headerEl.querySelector('#stickyRecordTime');
    timeEl.textContent = WavRecorder.formatTime(seconds);
  }

  _updateFilename(filename) {
    const filenameEl = this.headerEl.querySelector('#stickyRecordFilename');
    filenameEl.textContent = filename;
  }

  _updateMidiStatus(message) {
    const statusEl = this.headerEl.querySelector('#stickyMidiStatus');
    statusEl.textContent = message;
  }

  /**
   * Update patch info (e.g., when scale/key changes)
   */
  updatePatchInfo(info) {
    this.patchInfo = { ...this.patchInfo, ...info };
    if (this.recorder) {
      this.recorder.setPatchInfo(this.patchInfo);
    }
  }

  /**
   * Get MIDI Learn instance for registering controls
   */
  getMidiLearn() {
    return this.midiLearn;
  }

  /**
   * Cleanup
   */
  dispose() {
    if (this.recorder) {
      if (this.isRecording) {
        this.recorder.stop();
      }
      this.recorder.dispose();
    }

    if (this.headerEl) {
      this.headerEl.remove();
    }
  }
}

// Export
if (typeof window !== 'undefined') {
  window.StickyHeader = StickyHeader;
}

export { StickyHeader };
