// INSERT BUS - Insert Effects Routing Infrastructure
// Manages insert effects that process audio before it reaches send effects
// Signal chain: Voices → InsertBus (DataBender → Arbhar → Morphagene → Lubadh) → SendBus → Master

import { DataBenderNode } from './databender/index.js';
import { ArbharNode } from './arbhar/index.js';
import { MorphageneNode } from './morphagene/index.js';
import { LubadhNode } from './lubadh/index.js';

export class InsertBus {
    constructor(ctx, numVoices = 3) {
        this.ctx = ctx;
        this.numVoices = numVoices;

        // Voice input nodes - voices connect here
        this.voiceInputs = [];
        for (let i = 0; i < numVoices; i++) {
            const inputNode = ctx.createGain();
            inputNode.gain.value = 1;
            this.voiceInputs.push(inputNode);
        }

        // Voice summer - combines all voice inputs
        this.voiceSummer = ctx.createGain();
        this.voiceSummer.gain.value = 1;

        // Connect all voice inputs to summer
        for (const input of this.voiceInputs) {
            input.connect(this.voiceSummer);
        }

        // Insert effects chain
        // Signal flow: voiceSummer → DataBender → Arbhar → Morphagene → Lubadh → outputGain
        this.inserts = {
            databender: {
                node: null,
                isLoaded: false,
                enabled: false,
                inputGain: ctx.createGain(),
                outputGain: ctx.createGain(),
                bypassGain: ctx.createGain()
            },
            arbhar: {
                node: null,
                isLoaded: false,
                enabled: false,
                inputGain: ctx.createGain(),
                outputGain: ctx.createGain(),
                bypassGain: ctx.createGain()
            },
            morphagene: {
                node: null,
                isLoaded: false,
                enabled: false,
                inputGain: ctx.createGain(),
                outputGain: ctx.createGain(),
                bypassGain: ctx.createGain()
            },
            lubadh: {
                node: null,
                isLoaded: false,
                enabled: false,
                inputGain: ctx.createGain(),
                outputGain: ctx.createGain(),
                bypassGain: ctx.createGain()
            }
        };

        // Initialize Data Bender gains
        // Effect path starts OFF (outputGain = 0)
        // Bypass path starts ON (bypassGain = 1)
        this.inserts.databender.inputGain.gain.value = 1;
        this.inserts.databender.outputGain.gain.value = 0;
        this.inserts.databender.bypassGain.gain.value = 1;

        // Initialize Arbhar gains
        this.inserts.arbhar.inputGain.gain.value = 1;
        this.inserts.arbhar.outputGain.gain.value = 0;
        this.inserts.arbhar.bypassGain.gain.value = 1;

        // Initialize Morphagene gains
        this.inserts.morphagene.inputGain.gain.value = 1;
        this.inserts.morphagene.outputGain.gain.value = 0;
        this.inserts.morphagene.bypassGain.gain.value = 1;

        // Initialize Lubadh gains
        this.inserts.lubadh.inputGain.gain.value = 1;
        this.inserts.lubadh.outputGain.gain.value = 0;
        this.inserts.lubadh.bypassGain.gain.value = 1;

        // Chain point between DataBender and Arbhar
        this.chainPoint = ctx.createGain();
        this.chainPoint.gain.value = 1;

        // Chain point between Arbhar and Morphagene
        this.chainPoint2 = ctx.createGain();
        this.chainPoint2.gain.value = 1;

        // Chain point between Morphagene and Lubadh
        this.chainPoint3 = ctx.createGain();
        this.chainPoint3.gain.value = 1;

        // Output node - the single output point
        this.outputGain = ctx.createGain();
        this.outputGain.gain.value = 1;

        // Send output - taps the insert chain output for routing to send effects
        // This allows the processed insert signal to be sent to reverb/delay
        this.sendOutputGain = ctx.createGain();
        this.sendOutputGain.gain.value = 0; // Off by default

        // === SIGNAL ROUTING ===
        // DataBender section:
        // - BYPASS PATH: voiceSummer → databender.bypassGain → chainPoint
        // - EFFECT PATH: voiceSummer → databender.inputGain → [DataBender] → databender.outputGain → chainPoint
        this.voiceSummer.connect(this.inserts.databender.bypassGain);
        this.inserts.databender.bypassGain.connect(this.chainPoint);
        this.voiceSummer.connect(this.inserts.databender.inputGain);
        // databender.outputGain → chainPoint connection happens in loadDataBender()

        // Arbhar section:
        // - BYPASS PATH: chainPoint → arbhar.bypassGain → chainPoint2
        // - EFFECT PATH: chainPoint → arbhar.inputGain → [Arbhar] → arbhar.outputGain → chainPoint2
        this.chainPoint.connect(this.inserts.arbhar.bypassGain);
        this.inserts.arbhar.bypassGain.connect(this.chainPoint2);
        this.chainPoint.connect(this.inserts.arbhar.inputGain);
        // arbhar.outputGain → chainPoint2 connection happens in loadArbhar()

        // Morphagene section:
        // - BYPASS PATH: chainPoint2 → morphagene.bypassGain → chainPoint3
        // - EFFECT PATH: chainPoint2 → morphagene.inputGain → [Morphagene] → morphagene.outputGain → chainPoint3
        this.chainPoint2.connect(this.inserts.morphagene.bypassGain);
        this.inserts.morphagene.bypassGain.connect(this.chainPoint3);
        this.chainPoint2.connect(this.inserts.morphagene.inputGain);
        // morphagene.outputGain → chainPoint3 connection happens in loadMorphagene()

        // Lubadh section:
        // - BYPASS PATH: chainPoint3 → lubadh.bypassGain → outputGain
        // - EFFECT PATH: chainPoint3 → lubadh.inputGain → [Lubadh] → lubadh.outputGain → outputGain
        this.chainPoint3.connect(this.inserts.lubadh.bypassGain);
        this.inserts.lubadh.bypassGain.connect(this.outputGain);
        this.chainPoint3.connect(this.inserts.lubadh.inputGain);
        // lubadh.outputGain → outputGain connection happens in loadLubadh()

        // Connect output to send tap (for routing processed signal to send effects)
        this.outputGain.connect(this.sendOutputGain);

        // Loading state
        this.isLoading = false;
        this.isLoaded = false;
    }

    // Get the input node for a voice to connect to
    getVoiceInput(voiceIndex) {
        return this.voiceInputs[voiceIndex];
    }

    // === DATA BENDER ===

    // Load Data Bender insert effect
    async loadDataBender() {
        if (this.isLoading) {
            console.warn('InsertBus: Already loading');
            return null;
        }

        this.isLoading = true;

        try {
            const insert = this.inserts.databender;

            // Dispose existing if present
            if (insert.node) {
                insert.outputGain.disconnect();
                insert.node.dispose();
                insert.node = null;
                insert.isLoaded = false;
            }

            // Create new Data Bender node
            const databender = new DataBenderNode(this.ctx);
            await databender.initialize();

            // Connect: inputGain → databender → insert.outputGain → chainPoint
            insert.inputGain.connect(databender.input);
            databender.connect(insert.outputGain);
            insert.outputGain.connect(this.chainPoint);

            insert.node = databender;
            insert.isLoaded = true;
            this._updateLoadedState();

            // Apply current enabled state
            this._updateDataBenderRouting();

            return databender;

        } catch (error) {
            console.error('InsertBus: Failed to load Data Bender:', error);
            throw error;

        } finally {
            this.isLoading = false;
        }
    }

    // Enable/disable Data Bender insert
    setDataBenderEnabled(enabled) {
        this.inserts.databender.enabled = !!enabled;
        this._updateDataBenderRouting();
    }

    isDataBenderEnabled() {
        return this.inserts.databender.enabled;
    }

    toggleDataBender() {
        this.setDataBenderEnabled(!this.inserts.databender.enabled);
    }

    // Update routing based on enabled state
    _updateDataBenderRouting() {
        const insert = this.inserts.databender;

        if (insert.enabled && insert.isLoaded) {
            // Route through Data Bender ONLY
            insert.bypassGain.gain.value = 0;
            insert.outputGain.gain.value = 1;

            console.log('DataBender ENABLED: bypassGain=0, outputGain=1');

            // Set Data Bender mix to 100% wet when enabled
            if (insert.node) {
                insert.node.setParam('mix', 1);
            }
        } else {
            // Bypass: bypass on, insert output off
            insert.bypassGain.gain.value = 1;
            insert.outputGain.gain.value = 0;

            console.log('DataBender DISABLED: bypassGain=1, outputGain=0');
        }
    }

    // Get Data Bender node for parameter control
    getDataBender() {
        return this.inserts.databender.node;
    }

    // Check if Data Bender is loaded
    isDataBenderLoaded() {
        return this.inserts.databender.isLoaded;
    }

    // === ARBHAR ===

    // Load Arbhar insert effect
    async loadArbhar() {
        if (this.isLoading) {
            console.warn('InsertBus: Already loading');
            return null;
        }

        this.isLoading = true;

        try {
            const insert = this.inserts.arbhar;

            // Dispose existing if present
            if (insert.node) {
                insert.outputGain.disconnect();
                insert.node.dispose();
                insert.node = null;
                insert.isLoaded = false;
            }

            // Create new Arbhar node
            const arbhar = new ArbharNode(this.ctx);
            await arbhar.initialize();

            // Connect: inputGain → arbhar → insert.outputGain → chainPoint2
            insert.inputGain.connect(arbhar.input);
            arbhar.connect(insert.outputGain);
            insert.outputGain.connect(this.chainPoint2);

            insert.node = arbhar;
            insert.isLoaded = true;
            this._updateLoadedState();

            // Apply current enabled state
            this._updateArbharRouting();

            return arbhar;

        } catch (error) {
            console.error('InsertBus: Failed to load Arbhar:', error);
            throw error;

        } finally {
            this.isLoading = false;
        }
    }

    // Enable/disable Arbhar insert
    setArbharEnabled(enabled) {
        this.inserts.arbhar.enabled = !!enabled;
        this._updateArbharRouting();
    }

    isArbharEnabled() {
        return this.inserts.arbhar.enabled;
    }

    toggleArbhar() {
        this.setArbharEnabled(!this.inserts.arbhar.enabled);
    }

    // Update routing based on enabled state
    _updateArbharRouting() {
        const insert = this.inserts.arbhar;

        if (insert.enabled && insert.isLoaded) {
            // Route through Arbhar ONLY
            insert.bypassGain.gain.value = 0;
            insert.outputGain.gain.value = 1;

            console.log('Arbhar ENABLED: bypassGain=0, outputGain=1');

            // Set Arbhar mix to 100% wet when enabled
            if (insert.node) {
                insert.node.setParam('mix', 1);
            }
        } else {
            // Bypass: bypass on, insert output off
            insert.bypassGain.gain.value = 1;
            insert.outputGain.gain.value = 0;

            console.log('Arbhar DISABLED: bypassGain=1, outputGain=0');
        }
    }

    // Get Arbhar node for parameter control
    getArbhar() {
        return this.inserts.arbhar.node;
    }

    // Check if Arbhar is loaded
    isArbharLoaded() {
        return this.inserts.arbhar.isLoaded;
    }

    // === MORPHAGENE ===

    // Load Morphagene insert effect
    async loadMorphagene() {
        if (this.isLoading) {
            console.warn('InsertBus: Already loading');
            return null;
        }

        this.isLoading = true;

        try {
            const insert = this.inserts.morphagene;

            // Dispose existing if present
            if (insert.node) {
                insert.outputGain.disconnect();
                insert.node.dispose();
                insert.node = null;
                insert.isLoaded = false;
            }

            // Create new Morphagene node
            const morphagene = new MorphageneNode(this.ctx);
            await morphagene.initialize();

            // Connect: inputGain → morphagene → insert.outputGain → chainPoint3
            insert.inputGain.connect(morphagene.input);
            morphagene.connect(insert.outputGain);
            insert.outputGain.connect(this.chainPoint3);

            insert.node = morphagene;
            insert.isLoaded = true;
            this._updateLoadedState();

            // Apply current enabled state
            this._updateMorphageneRouting();

            return morphagene;

        } catch (error) {
            console.error('InsertBus: Failed to load Morphagene:', error);
            throw error;

        } finally {
            this.isLoading = false;
        }
    }

    // Enable/disable Morphagene insert
    setMorphageneEnabled(enabled) {
        this.inserts.morphagene.enabled = !!enabled;
        this._updateMorphageneRouting();
    }

    isMorphageneEnabled() {
        return this.inserts.morphagene.enabled;
    }

    toggleMorphagene() {
        this.setMorphageneEnabled(!this.inserts.morphagene.enabled);
    }

    // Update routing based on enabled state
    _updateMorphageneRouting() {
        const insert = this.inserts.morphagene;

        if (insert.enabled && insert.isLoaded) {
            // Route through Morphagene ONLY
            insert.bypassGain.gain.value = 0;
            insert.outputGain.gain.value = 1;

            console.log('Morphagene ENABLED: bypassGain=0, outputGain=1');

            // Set Morphagene mix to 100% wet when enabled
            if (insert.node) {
                insert.node.setParam('mix', 1);
            }
        } else {
            // Bypass: bypass on, insert output off
            insert.bypassGain.gain.value = 1;
            insert.outputGain.gain.value = 0;

            console.log('Morphagene DISABLED: bypassGain=1, outputGain=0');
        }
    }

    // Get Morphagene node for parameter control
    getMorphagene() {
        return this.inserts.morphagene.node;
    }

    // Check if Morphagene is loaded
    isMorphageneLoaded() {
        return this.inserts.morphagene.isLoaded;
    }

    // === LUBADH ===

    // Load Lubadh insert effect
    async loadLubadh() {
        if (this.isLoading) {
            console.warn('InsertBus: Already loading');
            return null;
        }

        this.isLoading = true;

        try {
            const insert = this.inserts.lubadh;

            // Dispose existing if present
            if (insert.node) {
                insert.outputGain.disconnect();
                insert.node.dispose();
                insert.node = null;
                insert.isLoaded = false;
            }

            // Create new Lubadh node
            const lubadh = new LubadhNode(this.ctx);
            await lubadh.initialize();

            // Connect: inputGain → lubadh → insert.outputGain → outputGain
            insert.inputGain.connect(lubadh.input);
            lubadh.connect(insert.outputGain);
            insert.outputGain.connect(this.outputGain);

            insert.node = lubadh;
            insert.isLoaded = true;
            this._updateLoadedState();

            // Apply current enabled state
            this._updateLubadhRouting();

            return lubadh;

        } catch (error) {
            console.error('InsertBus: Failed to load Lubadh:', error);
            throw error;

        } finally {
            this.isLoading = false;
        }
    }

    // Enable/disable Lubadh insert
    setLubadhEnabled(enabled) {
        this.inserts.lubadh.enabled = !!enabled;
        this._updateLubadhRouting();
    }

    isLubadhEnabled() {
        return this.inserts.lubadh.enabled;
    }

    toggleLubadh() {
        this.setLubadhEnabled(!this.inserts.lubadh.enabled);
    }

    // Update routing based on enabled state
    _updateLubadhRouting() {
        const insert = this.inserts.lubadh;

        if (insert.enabled && insert.isLoaded) {
            // Route through Lubadh ONLY
            insert.bypassGain.gain.value = 0;
            insert.outputGain.gain.value = 1;

            console.log('Lubadh ENABLED: bypassGain=0, outputGain=1');

            // Set Lubadh mix to 100% wet when enabled
            if (insert.node) {
                insert.node.setParam('mix', 1);
            }
        } else {
            // Bypass: bypass on, insert output off
            insert.bypassGain.gain.value = 1;
            insert.outputGain.gain.value = 0;

            console.log('Lubadh DISABLED: bypassGain=1, outputGain=0');
        }
    }

    // Get Lubadh node for parameter control
    getLubadh() {
        return this.inserts.lubadh.node;
    }

    // Check if Lubadh is loaded
    isLubadhLoaded() {
        return this.inserts.lubadh.isLoaded;
    }

    // === COMMON METHODS ===

    _updateLoadedState() {
        this.isLoaded = this.inserts.databender.isLoaded ||
                        this.inserts.arbhar.isLoaded ||
                        this.inserts.morphagene.isLoaded ||
                        this.inserts.lubadh.isLoaded;
    }

    // Get output node for connecting to SendBus
    get output() {
        return this.outputGain;
    }

    // Get send output node for routing processed insert signal to send effects
    get sendOutput() {
        return this.sendOutputGain;
    }

    // Set the send output level (0-1)
    setSendOutputLevel(level) {
        this.sendOutputGain.gain.setTargetAtTime(
            Math.max(0, Math.min(1, level)),
            this.ctx.currentTime,
            0.02
        );
    }

    // Get current send output level
    getSendOutputLevel() {
        return this.sendOutputGain.gain.value;
    }

    // Sync effects to clock system
    syncToClock(clockSystem) {
        if (this.inserts.databender.node?.syncToClock) {
            this.inserts.databender.node.syncToClock(clockSystem);
        }
        if (this.inserts.arbhar.node?.syncToClock) {
            this.inserts.arbhar.node.syncToClock(clockSystem);
        }
        if (this.inserts.morphagene.node?.syncToClock) {
            this.inserts.morphagene.node.syncToClock(clockSystem);
        }
        if (this.inserts.lubadh.node?.syncToClock) {
            this.inserts.lubadh.node.syncToClock(clockSystem);
        }
    }

    // Update BPM on effects
    setBPM(bpm) {
        if (this.inserts.databender.node?.setBPM) {
            this.inserts.databender.node.setBPM(bpm);
        }
        if (this.inserts.arbhar.node?.setBPM) {
            this.inserts.arbhar.node.setBPM(bpm);
        }
        if (this.inserts.morphagene.node?.setBPM) {
            this.inserts.morphagene.node.setBPM(bpm);
        }
        if (this.inserts.lubadh.node?.setBPM) {
            this.inserts.lubadh.node.setBPM(bpm);
        }
    }

    // Get state for serialization
    getState() {
        return {
            isLoaded: this.isLoaded,
            databender: {
                isLoaded: this.inserts.databender.isLoaded,
                enabled: this.inserts.databender.enabled,
                params: this.inserts.databender.node?.getParams?.() || null,
                preset: this.inserts.databender.node?.getPreset?.() || null
            },
            arbhar: {
                isLoaded: this.inserts.arbhar.isLoaded,
                enabled: this.inserts.arbhar.enabled,
                params: this.inserts.arbhar.node?.getParams?.() || null,
                preset: this.inserts.arbhar.node?.getPreset?.() || null
            },
            morphagene: {
                isLoaded: this.inserts.morphagene.isLoaded,
                enabled: this.inserts.morphagene.enabled,
                params: this.inserts.morphagene.node?.getParams?.() || null,
                preset: this.inserts.morphagene.node?.getPreset?.() || null
            },
            lubadh: {
                isLoaded: this.inserts.lubadh.isLoaded,
                enabled: this.inserts.lubadh.enabled,
                params: this.inserts.lubadh.node?.getParams?.() || null,
                preset: this.inserts.lubadh.node?.getPreset?.() || null
            }
        };
    }

    // Restore state
    async restoreState(state) {
        // Restore Data Bender
        if (state.databender) {
            if (state.databender.isLoaded) {
                await this.loadDataBender();

                if (state.databender.enabled !== undefined) {
                    this.setDataBenderEnabled(state.databender.enabled);
                }

                if (state.databender.preset && this.inserts.databender.node?.loadPreset) {
                    this.inserts.databender.node.loadPreset(state.databender.preset);
                } else if (state.databender.params && this.inserts.databender.node?.setParams) {
                    this.inserts.databender.node.setParams(state.databender.params);
                }
            }
        }

        // Restore Arbhar
        if (state.arbhar) {
            if (state.arbhar.isLoaded) {
                await this.loadArbhar();

                if (state.arbhar.enabled !== undefined) {
                    this.setArbharEnabled(state.arbhar.enabled);
                }

                if (state.arbhar.preset && this.inserts.arbhar.node?.loadPreset) {
                    this.inserts.arbhar.node.loadPreset(state.arbhar.preset);
                } else if (state.arbhar.params && this.inserts.arbhar.node?.setParams) {
                    this.inserts.arbhar.node.setParams(state.arbhar.params);
                }
            }
        }

        // Restore Morphagene
        if (state.morphagene) {
            if (state.morphagene.isLoaded) {
                await this.loadMorphagene();

                if (state.morphagene.enabled !== undefined) {
                    this.setMorphageneEnabled(state.morphagene.enabled);
                }

                if (state.morphagene.preset && this.inserts.morphagene.node?.loadPreset) {
                    this.inserts.morphagene.node.loadPreset(state.morphagene.preset);
                } else if (state.morphagene.params && this.inserts.morphagene.node?.setParams) {
                    this.inserts.morphagene.node.setParams(state.morphagene.params);
                }
            }
        }

        // Restore Lubadh
        if (state.lubadh) {
            if (state.lubadh.isLoaded) {
                await this.loadLubadh();

                if (state.lubadh.enabled !== undefined) {
                    this.setLubadhEnabled(state.lubadh.enabled);
                }

                if (state.lubadh.preset && this.inserts.lubadh.node?.loadPreset) {
                    this.inserts.lubadh.node.loadPreset(state.lubadh.preset);
                } else if (state.lubadh.params && this.inserts.lubadh.node?.setParams) {
                    this.inserts.lubadh.node.setParams(state.lubadh.params);
                }
            }
        }
    }

    // Cleanup
    dispose() {
        // Dispose Data Bender
        if (this.inserts.databender.node) {
            this.inserts.databender.node.dispose();
            this.inserts.databender.node = null;
        }

        // Dispose Arbhar
        if (this.inserts.arbhar.node) {
            this.inserts.arbhar.node.dispose();
            this.inserts.arbhar.node = null;
        }

        // Dispose Morphagene
        if (this.inserts.morphagene.node) {
            this.inserts.morphagene.node.dispose();
            this.inserts.morphagene.node = null;
        }

        // Dispose Lubadh
        if (this.inserts.lubadh.node) {
            this.inserts.lubadh.node.dispose();
            this.inserts.lubadh.node = null;
        }

        // Disconnect all gains
        this.inserts.databender.inputGain?.disconnect();
        this.inserts.databender.outputGain?.disconnect();
        this.inserts.databender.bypassGain?.disconnect();

        this.inserts.arbhar.inputGain?.disconnect();
        this.inserts.arbhar.outputGain?.disconnect();
        this.inserts.arbhar.bypassGain?.disconnect();

        this.inserts.morphagene.inputGain?.disconnect();
        this.inserts.morphagene.outputGain?.disconnect();
        this.inserts.morphagene.bypassGain?.disconnect();

        this.inserts.lubadh.inputGain?.disconnect();
        this.inserts.lubadh.outputGain?.disconnect();
        this.inserts.lubadh.bypassGain?.disconnect();

        this.chainPoint?.disconnect();
        this.chainPoint2?.disconnect();
        this.chainPoint3?.disconnect();

        // Disconnect voice inputs
        this.voiceInputs.forEach(input => {
            input?.disconnect();
        });
        this.voiceInputs = [];

        this.voiceSummer?.disconnect();
        this.outputGain?.disconnect();
        this.sendOutputGain?.disconnect();

        this.isLoaded = false;
    }
}

// Factory function
export function createInsertBus(ctx, numVoices = 3) {
    return new InsertBus(ctx, numVoices);
}
