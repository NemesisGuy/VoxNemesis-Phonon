// Model registry — defines every Phonon checkpoint the extension can use.
//
// The active model ID is persisted in chrome.storage.local as 'selectedModel'.
//
// The browser build of phonon-tts can only load PUBLIC Hugging Face repos: it has no token to
// send, so a gated repo cannot be read. The gated Phonon 40m checkpoints are listed here
// anyway, with a 'localFolder', because a user who accepts the licence can download the files
// by hand and drop them in the extension folder. The loader prefers the local copy and falls
// back to the Hub.

const MODELS = {
    'phonon-31m-en': {
        id: 'phonon-31m-en',
        name: 'Phonon 31m',
        description: 'English only. Small, fast, Apache-2.0 — ships in the browser.',
        repo: 'hf://gradium/phonon-31m-en@8c64b55ec301728e2d1695bfea87a08a267d0c2d',
        languages: [
            { code: 'en', name: 'English' }
        ],
        license: 'Apache-2.0',
        weightsMb: 64.5,
        gated: false,
        localFolder: 'models/phonon-31m-en'
    },
    'phonon-40m-multilingual': {
        id: 'phonon-40m-multilingual',
        name: 'Phonon 40m (Multilingual)',
        description: 'All five languages. Gated on the Hub — needs local files.',
        repo: 'hf://gradium/phonon-40m-multilingual',
        languages: [
            { code: 'en', name: 'English' },
            { code: 'fr', name: 'French' },
            { code: 'de', name: 'German' },
            { code: 'es', name: 'Spanish' },
            { code: 'pt', name: 'Portuguese' }
        ],
        license: 'CC BY-NC 4.0',
        weightsMb: 74.6,
        gated: true,
        localFolder: 'models/phonon-40m-multilingual'
    }
};

const MODEL_IDS = Object.keys(MODELS);
const DEFAULT_MODEL = 'phonon-31m-en';

/** The languages Phonon can normalize text for, including the pass-through one. */
const NORMALIZATION_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'es', name: 'Spanish' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'none', name: 'None (read as written)' }
];

function getModel(modelId) {
    return MODELS[modelId] || MODELS[DEFAULT_MODEL];
}

function getLanguagesForModel(modelId) {
    return getModel(modelId).languages;
}

/** The languages a model can speak, for the language dropdown. */
function getModelLanguageCodes(modelId) {
    return getModel(modelId).languages.map((l) => l.code);
}

/** True when the model must be loaded from the local folder rather than the Hub. */
function requiresLocalFiles(modelId) {
    return Boolean(getModel(modelId).gated);
}

/**
 * The language to normalize text as. Phonon refuses to guess: the spoken forms of '@', '+'
 * and '=' differ per language, so normalizing German as English is worse than not normalizing
 * at all. A model that only speaks English normalizes as English.
 */
function getNormalizationLanguage(modelId, requested) {
    const codes = getModelLanguageCodes(modelId);
    if (requested && codes.includes(requested)) return requested;
    return codes[0] || 'en';
}

export {
    MODELS,
    MODEL_IDS,
    DEFAULT_MODEL,
    NORMALIZATION_LANGUAGES,
    getModel,
    getLanguagesForModel,
    getModelLanguageCodes,
    requiresLocalFiles,
    getNormalizationLanguage
};

// CommonJS compat for Jest tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MODELS,
        MODEL_IDS,
        DEFAULT_MODEL,
        NORMALIZATION_LANGUAGES,
        getModel,
        getLanguagesForModel,
        getModelLanguageCodes,
        requiresLocalFiles,
        getNormalizationLanguage
    };
}
