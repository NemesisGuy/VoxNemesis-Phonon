// Helpers for the Phonon engine.
//
// Everything here is pure and testable: the offscreen document owns the model and the
// Web Audio graph, this file owns the arithmetic and the URL building.

import { MODELS, getNormalizationLanguage } from './models.js';

const MIN_SPEED = 0.5;
const MAX_SPEED = 2.0;
const DEFAULT_SEED = 4242424242424242n;
const MAX_SEED = (1n << 64n) - 1n;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * The speaking-rate conditioner for a speed multiplier.
 *
 * Phonon has no rate knob: it has a 'duration_delta' conditioner, negative for faster speech
 * and positive for slower. The scale is the model's own and is not a multiplier, so this is a
 * deliberate, conservative mapping rather than an exact one: 1.0x is 0, and every step away
 * from it moves the conditioner by the same amount. Clamped so the value stays inside the
 * range the checkpoints accept.
 */
function speedToDurationDelta(speed) {
    const factor = clamp(Number(speed) || 1, MIN_SPEED, MAX_SPEED);
    const delta = clamp(-(factor - 1), -0.8, 0.8);
    // `-(1 - 1)` is -0, which is not the same value as 0 to a comparison.
    return delta === 0 ? 0 : delta;
}

/** The conditioners a synthesis request runs with. */
function buildConditions(settings) {
    const conditions = {};
    const delta = speedToDurationDelta(settings?.speed);
    if (delta !== 0) conditions.duration_delta = delta;
    return conditions;
}

/**
 * A ModelSpec for a checkpoint stored in the extension's own folder.
 *
 * The browser's wasm build reads a checkpoint from four places: the weights, the tokenizer,
 * the config and its voices. Each is addressed by an absolute URL, so the caller passes the
 * function that turns a path in the extension into one.
 */
function buildLocalModelSpec(modelId, resolveUrl) {
    const model = MODELS[modelId];
    if (!model) throw new Error(`unknown model '${modelId}'`);
    const folder = model.localFolder;
    if (!folder) throw new Error(`model '${modelId}' has no local folder`);

    const spec = {
        weights: {
            q8: resolveUrl(`${folder}/model.q8.gguf`),
            f32: resolveUrl(`${folder}/model.safetensors`)
        },
        tokenizer: resolveUrl(`${folder}/tokenizer.json`),
        config: resolveUrl(`${folder}/config.json`),
        voices: {}
    };

    // The voices a checkpoint ships with. A missing file is not fatal: the catalog voices are
    // added separately, and the checkpoint's own default is enough to speak.
    for (const name of model.localVoices || []) {
        spec.voices[name] = resolveUrl(`${folder}/voices/${name}.safetensors`);
    }

    if (model.localDefaultVoice) spec.defaultVoice = model.localDefaultVoice;
    return spec;
}

/**
 * The language text is normalized as, for a model and a requested language.
 *
 * The model decides what it can speak; the request only picks between those. A request for a
 * language the model does not speak falls back to the model's first.
 */
function resolveLanguage(modelId, requested) {
    return getNormalizationLanguage(modelId, requested);
}

/**
 * Split text into sentences, keeping the whitespace that follows each one.
 *
 * Used to place a seek inside the text: Phonon streams, so seeking means generating again
 * from some point in the text, and a sentence boundary is the only place where a cut does
 * not land mid-word.
 */
function splitIntoSentences(text) {
    if (typeof text !== 'string' || text.length === 0) return [];
    const parts = text.match(/[^.!?…]*[.!?…]+(?:["')\]]*)\s*|[^.!?…]+$/g);
    return parts ? parts.filter((p) => p.length > 0) : [text];
}

/**
 * The character offset in `text` that is about `seconds` into the audio.
 *
 * Approximate: Phonon gives no word timings, and speech is not evenly spread over a text, so
 * this distributes the time over the sentences by their length. Good enough to land near the
 * right sentence; it is not a sample-accurate position.
 */
function offsetForTime(text, seconds, totalSeconds) {
    const sentences = splitIntoSentences(text);
    if (sentences.length === 0) return 0;
    if (!Number.isFinite(seconds) || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return 0;

    const ratio = clamp(seconds / totalSeconds, 0, 1);
    const lengths = sentences.map((s) => s.length);
    const total = lengths.reduce((a, b) => a + b, 0);
    if (total <= 0) return 0;

    let accumulated = 0;
    for (let i = 0; i < sentences.length; i += 1) {
        accumulated += lengths[i];
        if (accumulated / total >= ratio) {
            const before = sentences.slice(0, i).reduce((a, s) => a + s.length, 0);
            return before;
        }
    }
    return 0;
}

/** The text from a character offset on, for a seek. */
function textFromOffset(text, offset) {
    if (typeof text !== 'string') return '';
    const start = clamp(Math.floor(offset || 0), 0, Math.max(0, text.length - 1));
    return text.slice(start);
}

/** A seed Phonon accepts: a whole number from 0 to 2^64 - 1, as a BigInt. */
function normalizeSeed(seed) {
    if (seed === null || seed === undefined || seed === '') return DEFAULT_SEED;
    let value;
    if (typeof seed === 'bigint') {
        value = seed;
    } else if (typeof seed === 'number') {
        if (!Number.isSafeInteger(seed)) return null;
        value = BigInt(seed);
    } else if (typeof seed === 'string' && /^\d+$/.test(seed.trim())) {
        value = BigInt(seed.trim());
    } else {
        return null;
    }
    if (value < 0n || value > MAX_SEED) return null;
    return value;
}

/** Seconds as m:ss, the way the popup shows it. */
function formatTime(seconds) {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** A rough duration for a text, for the timeline before the audio exists. */
function estimateDuration(text, speed = 1) {
    if (typeof text !== 'string' || text.length === 0) return 0;
    const words = text.trim().split(/\s+/).length;
    const factor = clamp(Number(speed) || 1, MIN_SPEED, MAX_SPEED);
    // A little under three words a second, which is close to how fast Phonon reads.
    return (words / (2.9 * factor));
}

export {
    MIN_SPEED,
    MAX_SPEED,
    DEFAULT_SEED,
    clamp,
    speedToDurationDelta,
    buildConditions,
    buildLocalModelSpec,
    resolveLanguage,
    splitIntoSentences,
    offsetForTime,
    textFromOffset,
    normalizeSeed,
    formatTime,
    estimateDuration
};

// CommonJS compat for Jest tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MIN_SPEED,
        MAX_SPEED,
        DEFAULT_SEED,
        clamp,
        speedToDurationDelta,
        buildConditions,
        buildLocalModelSpec,
        resolveLanguage,
        splitIntoSentences,
        offsetForTime,
        textFromOffset,
        normalizeSeed,
        formatTime,
        estimateDuration
    };
}
