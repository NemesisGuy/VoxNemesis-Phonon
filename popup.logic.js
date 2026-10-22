// Overlay/status helpers for the popup, and the voice list it shows.
//
// Pure functions, exported as ESM and CommonJS so the popup and the tests use the same code.

import { VOICES, findVoice } from './lib/voices.js';
import { getModel, getModelLanguageCodes } from './lib/models.js';
import { formatTime } from './lib/helper.js';

/**
 * What the download overlay should do, given a message from the offscreen engine.
 *
 * The engine reports four phases: start, download, ready and error. Anything else is noise
 * and is left alone.
 */
export function deriveOverlayState(msg) {
    if (!msg || msg.target === 'offscreen') return { action: 'noop' };
    if (msg.phase === 'start') {
        return { action: 'show', text: msg.message || 'Loading the Phonon model...', isError: false };
    }
    if (msg.phase === 'download') {
        const detail = msg.status === 'cached' ? 'cached' : 'downloading';
        return { action: 'show', text: `${msg.file || 'Model'}: ${detail}...`, isError: false };
    }
    if (msg.phase === 'ready') {
        return { action: 'hide', text: msg.message || 'Model ready.', isError: false };
    }
    if (msg.phase === 'error') {
        return { action: 'show', text: msg.message || 'The model could not be loaded.', isError: true };
    }
    return { action: 'noop' };
}

/**
 * The voices the popup offers: the ones the checkpoint ships with, plus the Gradium catalog.
 *
 * The checkpoint's own voices come first and win on a name clash, since they are the ones
 * the model was trained against.
 */
export function buildVoiceList(modelVoices = [], language = null) {
    const names = new Set();

    for (const voice of modelVoices || []) {
        if (voice) names.add(voice);
    }

    const codes = language ? [language] : null;
    for (const voice of VOICES) {
        if (!codes || codes.includes(voice.language)) {
            names.add(voice.name);
        }
    }

    return [...names].sort((a, b) => a.localeCompare(b));
}

/** The label shown for a voice: its name, and where it comes from. */
export function voiceLabel(name) {
    const entry = findVoice(name);
    if (entry) return `${entry.name} — ${entry.locale} ${entry.gender}`;
    return `${name} (checkpoint)`;
}

/** The languages the language dropdown offers for a model. */
export function languagesForModel(modelId) {
    return getModelLanguageCodes(modelId).map((code) => {
        const known = getModel(modelId).languages.find((l) => l.code === code);
        return { code, name: known ? known.name : code };
    });
}

/** The playback state the popup's buttons should be in. */
export function derivePlaybackState(status) {
    if (!status) return { canPlay: false, canPause: false, canStop: false, label: 'Ready to read' };

    if (status.isPlaying) {
        return { canPlay: false, canPause: true, canStop: true, label: 'Playing...' };
    }
    if (status.isPaused) {
        return { canPlay: true, canPause: false, canStop: true, label: 'Paused' };
    }
    if (status.hasAudio) {
        return { canPlay: true, canPause: false, canStop: true, label: 'Audio ready. Press play.' };
    }
    if (status.mode === 'streaming' && status.lastText) {
        return { canPlay: true, canPause: false, canStop: true, label: 'Ready to play' };
    }
    return { canPlay: false, canPause: false, canStop: false, label: 'Ready to read' };
}

/** The timeline's two labels. */
export function timelineLabels(status) {
    return {
        current: formatTime(status ? status.currentTime : 0),
        duration: formatTime(status ? status.duration : 0)
    };
}

export { formatTime };

// CommonJS export for Jest
if (typeof module !== 'undefined') {
    module.exports = {
        deriveOverlayState,
        buildVoiceList,
        voiceLabel,
        languagesForModel,
        derivePlaybackState,
        timelineLabels,
        formatTime
    };
}
