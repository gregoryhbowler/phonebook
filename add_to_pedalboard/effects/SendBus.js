// SEND BUS - Send/Return Effects Routing Infrastructure
// Manages send effects (Nautilus delay, Basil delay, FDNR reverb) with per-voice, per-effect send amounts
// Like a mixing console with multiple aux sends per channel
// Note: Data Bender is now an insert effect managed by InsertBus

import { NautilusNode } from './nautilus/index.js';
import { BasilNode } from './basil/index.js';
import { FDNRNode } from './fdnr/index.js';

export class SendBus {
    constructor(ctx, numVoices = 3) {
        this.ctx = ctx;
        this.numVoices = numVoices;

        // Return infrastructure - all effect outputs mix here before master
        this.returnGain = ctx.createGain();
        this.returnGain.gain.value = 1;

        // Available effect types (extensible for future effects)
        // Note: databender is now an insert effect, not a send effect
        this.availableEffects = ['nautilus', 'basil', 'fdnr'];

        // Effects registry - each effect has its own input gain and voice sends
        this.effects = {};
        for (const effectType of this.availableEffects) {
            this.effects[effectType] = {
                node: null,
                inputGain: ctx.createGain(),  // Master input to this effect
                isLoaded: false,
                voiceSends: [],  // Per-voice send gains to this effect
                insertSend: null // Insert bus send gain to this effect
            };
            this.effects[effectType].inputGain.gain.value = 1;

            // Create per-voice send gains for this effect
            for (let i = 0; i < numVoices; i++) {
                const sendGain = ctx.createGain();
                sendGain.gain.value = 0;  // Off by default
                sendGain.connect(this.effects[effectType].inputGain);
                this.effects[effectType].voiceSends.push({
                    node: sendGain,
                    amount: 0
                });
            }

            // Create insert bus send gain for this effect (4th channel)
            const insertSendGain = ctx.createGain();
            insertSendGain.gain.value = 0;  // Off by default
            insertSendGain.connect(this.effects[effectType].inputGain);
            this.effects[effectType].insertSend = {
                node: insertSendGain,
                amount: 0
            };
        }

        // Voice input nodes - voices connect here, then we split to each effect's sends
        // Each voice has a splitter node that feeds all effect sends
        this.voiceInputs = [];
        for (let i = 0; i < numVoices; i++) {
            const inputNode = ctx.createGain();
            inputNode.gain.value = 1;
            this.voiceInputs.push(inputNode);

            // Connect this voice input to each effect's per-voice send
            for (const effectType of this.availableEffects) {
                inputNode.connect(this.effects[effectType].voiceSends[i].node);
            }
        }

        // Insert bus input node - insert bus sendOutput connects here
        // This feeds all effect's insert sends
        this.insertBusInput = ctx.createGain();
        this.insertBusInput.gain.value = 1;

        // Legacy support
        this.currentEffect = null;
        this.effectType = null;

        // Loading state
        this.isLoading = false;
        this.isLoaded = false;
    }

    // Get the input node for a voice to connect to
    // Voices should connect their output to this node
    getVoiceInput(voiceIndex) {
        return this.voiceInputs[voiceIndex];
    }

    // Create a voice send connection (returns the node voice should connect to)
    // This is for backwards compatibility
    createVoiceSend(voiceIndex) {
        return this.voiceInputs[voiceIndex];
    }

    // Set send amount for a voice to a specific effect (0-1)
    setVoiceSendAmount(voiceIndex, effectType, amount) {
        const effect = this.effects[effectType];
        if (effect && effect.voiceSends[voiceIndex]) {
            const send = effect.voiceSends[voiceIndex];
            send.amount = Math.max(0, Math.min(1, amount));
            send.node.gain.setTargetAtTime(
                send.amount,
                this.ctx.currentTime,
                0.02
            );
        }
    }

    // Get send amount for a voice to a specific effect
    getVoiceSendAmount(voiceIndex, effectType) {
        const effect = this.effects[effectType];
        return effect?.voiceSends[voiceIndex]?.amount || 0;
    }

    // Connect insert bus send output to this send bus
    connectInsertBus(insertBus) {
        if (insertBus?.sendOutput) {
            insertBus.sendOutput.connect(this.insertBusInput);

            // Connect insert bus input to each effect's insert send
            for (const effectType of this.availableEffects) {
                this.insertBusInput.connect(this.effects[effectType].insertSend.node);
            }
        }
    }

    // Set insert send amount to a specific effect (0-1)
    setInsertSendAmount(effectType, amount) {
        const effect = this.effects[effectType];
        if (effect?.insertSend) {
            const send = effect.insertSend;
            send.amount = Math.max(0, Math.min(1, amount));
            send.node.gain.setTargetAtTime(
                send.amount,
                this.ctx.currentTime,
                0.02
            );
        }
    }

    // Get insert send amount to a specific effect
    getInsertSendAmount(effectType) {
        const effect = this.effects[effectType];
        return effect?.insertSend?.amount || 0;
    }

    // Set insert send amount to ALL effects
    setInsertSendAmountAll(amount) {
        for (const effectType of this.availableEffects) {
            this.setInsertSendAmount(effectType, amount);
        }
    }

    // Get all insert send amounts
    getInsertSends() {
        const sends = {};
        for (const effectType of this.availableEffects) {
            sends[effectType] = this.getInsertSendAmount(effectType);
        }
        return sends;
    }

    // Set send amount for a voice to ALL effects (legacy compatibility)
    setVoiceSendAmountAll(voiceIndex, amount) {
        for (const effectType of this.availableEffects) {
            this.setVoiceSendAmount(voiceIndex, effectType, amount);
        }
    }

    // Legacy method - sets send to primary effect (nautilus)
    setVoiceSendAmountLegacy(voiceIndex, amount) {
        this.setVoiceSendAmount(voiceIndex, 'nautilus', amount);
    }

    // Set master input level for a specific effect
    setEffectInputLevel(effectType, level) {
        const effect = this.effects[effectType];
        if (effect) {
            effect.inputGain.gain.setTargetAtTime(
                Math.max(0, Math.min(2, level)),
                this.ctx.currentTime,
                0.02
            );
        }
    }

    // Get master input level for a specific effect
    getEffectInputLevel(effectType) {
        return this.effects[effectType]?.inputGain.gain.value || 0;
    }

    // Set return level (master effect output volume)
    setReturnLevel(level) {
        this.returnGain.gain.setTargetAtTime(
            Math.max(0, Math.min(2, level)),
            this.ctx.currentTime,
            0.02
        );
    }

    // Load an effect
    async loadEffect(effectType) {
        if (this.isLoading) {
            console.warn('SendBus: Already loading an effect');
            return null;
        }

        this.isLoading = true;

        try {
            const effectSlot = this.effects[effectType];
            if (!effectSlot) {
                throw new Error(`Unknown effect type: ${effectType}`);
            }

            // Dispose existing effect if exists
            if (effectSlot.node) {
                effectSlot.inputGain.disconnect(effectSlot.node.input);
                effectSlot.node.dispose();
                effectSlot.node = null;
                effectSlot.isLoaded = false;
            }

            // Create new effect
            let effectNode;
            switch (effectType) {
                case 'nautilus': {
                    effectNode = new NautilusNode(this.ctx);
                    await effectNode.initialize();
                    break;
                }
                case 'basil': {
                    effectNode = new BasilNode(this.ctx);
                    await effectNode.initialize();
                    break;
                }
                case 'fdnr': {
                    effectNode = new FDNRNode(this.ctx);
                    await effectNode.initialize();
                    break;
                }
                default:
                    throw new Error(`Unknown effect type: ${effectType}`);
            }

            // Connect: inputGain -> effect input
            effectSlot.inputGain.connect(effectNode.input);

            // Connect: effect output -> returnGain
            effectNode.connect(this.returnGain);

            effectSlot.node = effectNode;
            effectSlot.isLoaded = true;

            // Legacy support - first loaded effect becomes "current"
            if (!this.currentEffect) {
                this.currentEffect = effectNode;
                this.effectType = effectType;
            }

            this.isLoaded = true;

            return effectNode;

        } catch (error) {
            console.error('SendBus: Failed to load effect:', error);
            throw error;

        } finally {
            this.isLoading = false;
        }
    }

    // Load all available effects
    async loadAllEffects() {
        const results = {};
        for (const effectType of this.availableEffects) {
            try {
                results[effectType] = await this.loadEffect(effectType);
            } catch (error) {
                console.warn(`SendBus: Failed to load ${effectType}:`, error);
                results[effectType] = null;
            }
        }
        return results;
    }

    // Unload a specific effect
    unloadEffect(effectType) {
        const effectSlot = this.effects[effectType];
        if (effectSlot?.node) {
            try {
                effectSlot.inputGain.disconnect(effectSlot.node.input);
            } catch (e) {
                // May already be disconnected
            }
            effectSlot.node.dispose();
            effectSlot.node = null;
            effectSlot.isLoaded = false;

            if (this.currentEffect === effectSlot.node) {
                this.currentEffect = null;
                this.effectType = null;
            }
        }
    }

    // Unload all effects
    unloadAllEffects() {
        for (const effectType of this.availableEffects) {
            this.unloadEffect(effectType);
        }
        this.currentEffect = null;
        this.effectType = null;
        this.isLoaded = false;
    }

    // Get the return node for connecting to master
    get output() {
        return this.returnGain;
    }

    // Get specific effect for parameter control
    getEffect(effectType) {
        return this.effects[effectType]?.node || null;
    }

    // Get Nautilus effect
    getNautilus() {
        return this.effects.nautilus?.node || null;
    }

    // Get Basil effect
    getBasil() {
        return this.effects.basil?.node || null;
    }

    // Get FDNR effect
    getFDNR() {
        return this.effects.fdnr?.node || null;
    }

    // Check if specific effect is loaded
    isEffectLoaded(effectType) {
        return this.effects[effectType]?.isLoaded || false;
    }

    // Legacy: Set send level to a specific effect (now sets input level)
    setEffectSendLevel(effectType, level) {
        this.setEffectInputLevel(effectType, level);
    }

    // Legacy: Get send level for a specific effect
    getEffectSendLevel(effectType) {
        return this.getEffectInputLevel(effectType);
    }

    // Sync all effects to clock system
    syncToClock(clockSystem) {
        for (const effectSlot of Object.values(this.effects)) {
            if (effectSlot.node?.syncToClock) {
                effectSlot.node.syncToClock(clockSystem);
            }
        }
    }

    // Update BPM on all effects
    setBPM(bpm) {
        for (const effectSlot of Object.values(this.effects)) {
            if (effectSlot.node?.setBPM) {
                effectSlot.node.setBPM(bpm);
            }
        }
    }

    // Get all voice send amounts for a specific effect
    getVoiceSendsForEffect(effectType) {
        const effect = this.effects[effectType];
        if (!effect) return [];
        return effect.voiceSends.map(s => s.amount);
    }

    // Get state for serialization
    getState() {
        const effectsState = {};
        for (const [type, slot] of Object.entries(this.effects)) {
            effectsState[type] = {
                isLoaded: slot.isLoaded,
                inputLevel: slot.inputGain.gain.value,
                voiceSends: slot.voiceSends.map(s => s.amount),
                insertSend: slot.insertSend?.amount || 0,
                params: slot.node?.getParams?.() || null
            };
        }

        return {
            isLoaded: this.isLoaded,
            returnLevel: this.returnGain.gain.value,
            effects: effectsState
        };
    }

    // Restore state
    async restoreState(state) {
        if (state.returnLevel !== undefined) {
            this.setReturnLevel(state.returnLevel);
        }

        if (state.effects) {
            for (const [type, effectState] of Object.entries(state.effects)) {
                if (effectState.isLoaded) {
                    await this.loadEffect(type);

                    if (effectState.inputLevel !== undefined) {
                        this.setEffectInputLevel(type, effectState.inputLevel);
                    }

                    if (effectState.voiceSends) {
                        effectState.voiceSends.forEach((amount, i) => {
                            this.setVoiceSendAmount(i, type, amount);
                        });
                    }

                    if (effectState.insertSend !== undefined) {
                        this.setInsertSendAmount(type, effectState.insertSend);
                    }

                    if (effectState.params && this.effects[type].node?.setParams) {
                        this.effects[type].node.setParams(effectState.params);
                    }
                }
            }
        }
    }

    // Cleanup
    dispose() {
        this.unloadAllEffects();

        // Disconnect voice inputs
        this.voiceInputs.forEach(input => {
            input?.disconnect();
        });
        this.voiceInputs = [];

        // Disconnect effect send gains
        for (const effect of Object.values(this.effects)) {
            effect.voiceSends.forEach(send => {
                send.node?.disconnect();
            });
            effect.voiceSends = [];
            effect.insertSend?.node?.disconnect();
            effect.insertSend = null;
            effect.inputGain?.disconnect();
        }

        // Disconnect insert bus input
        this.insertBusInput?.disconnect();

        this.returnGain?.disconnect();
    }
}

// Factory function
export function createSendBus(ctx, numVoices = 3) {
    return new SendBus(ctx, numVoices);
}
