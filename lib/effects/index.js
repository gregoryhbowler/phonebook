// ============================================================================
// EXTERNAL EFFECTS INDEX
// Exports all external effect adapters for the pedalboard system
// ============================================================================

// Import and re-export all adapters
export { MimeophonAdapter } from './mimeophon-adapter.js';
export { NautilusAdapter } from './nautilus-adapter.js';
export { ArbharAdapter } from './arbhar-adapter.js';
export { MorphageneAdapter } from './morphagene-adapter.js';
export { LubadhAdapter } from './lubadh-adapter.js';
export { DataBenderAdapter } from './databender-adapter.js';
export { BasilAdapter } from './basil-adapter.js';
export { FDNRAdapter } from './fdnr-adapter.js';

// Re-export the registry utilities
export {
  ExternalEffectRegistry,
  registerExternalEffect,
  isExternalEffect,
  createEffectWrapper
} from '../effect-wrapper.js';

// Adapter lookup by type
export const AdapterRegistry = {
  mimeophon: () => import('./mimeophon-adapter.js').then(m => m.MimeophonAdapter),
  nautilus: () => import('./nautilus-adapter.js').then(m => m.NautilusAdapter),
  arbhar: () => import('./arbhar-adapter.js').then(m => m.ArbharAdapter),
  morphagene: () => import('./morphagene-adapter.js').then(m => m.MorphageneAdapter),
  lubadh: () => import('./lubadh-adapter.js').then(m => m.LubadhAdapter),
  databender: () => import('./databender-adapter.js').then(m => m.DataBenderAdapter),
  basil: () => import('./basil-adapter.js').then(m => m.BasilAdapter),
  fdnr: () => import('./fdnr-adapter.js').then(m => m.FDNRAdapter),
};

/**
 * Get an adapter class by effect type
 */
export async function getAdapter(effectType) {
  const loader = AdapterRegistry[effectType];
  if (!loader) {
    throw new Error(`Unknown external effect type: ${effectType}`);
  }
  return loader();
}
