const {
    MODELS,
    MODEL_IDS,
    DEFAULT_MODEL,
    getModel,
    getLanguagesForModel,
    getModelLanguageCodes,
    requiresLocalFiles,
    getNormalizationLanguage
} = require('../lib/models.js');

describe('the model registry', () => {
    it('has an entry per model and a default among them', () => {
        expect(MODEL_IDS.length).toBeGreaterThan(0);
        expect(MODEL_IDS).toContain(DEFAULT_MODEL);
    });

    it('gives every model the fields the extension needs', () => {
        MODEL_IDS.forEach((id) => {
            const model = MODELS[id];
            expect(model.id).toBe(id);
            expect(typeof model.name).toBe('string');
            expect(model.repo).toMatch(/^hf:\/\//);
            expect(model.languages.length).toBeGreaterThan(0);
            expect(typeof model.gated).toBe('boolean');
            expect(model.localFolder).toContain('models/');
        });
    });

    it('gives every model a language Phonon can normalize for', () => {
        MODEL_IDS.forEach((id) => {
            getModelLanguageCodes(id).forEach((code) => {
                expect(['en', 'fr', 'de', 'es', 'pt']).toContain(code);
            });
        });
    });
});

describe('getModel', () => {
    it('falls back to the default for an unknown id', () => {
        expect(getModel('nope').id).toBe(DEFAULT_MODEL);
    });
});

describe('getLanguagesForModel', () => {
    it('gives English for the English model', () => {
        expect(getLanguagesForModel('phonon-31m-en').map((l) => l.code)).toEqual(['en']);
    });

    it('gives five languages for the multilingual model', () => {
        expect(getModelLanguageCodes('phonon-40m-multilingual')).toEqual(['en', 'fr', 'de', 'es', 'pt']);
    });
});

describe('requiresLocalFiles', () => {
    it('is false for the public checkpoint', () => {
        expect(requiresLocalFiles('phonon-31m-en')).toBe(false);
    });

    it('is true for the gated one', () => {
        expect(requiresLocalFiles('phonon-40m-multilingual')).toBe(true);
    });
});

describe('getNormalizationLanguage', () => {
    it('keeps a language the model speaks', () => {
        expect(getNormalizationLanguage('phonon-40m-multilingual', 'de')).toBe('de');
    });

    it('falls back when the model does not speak it', () => {
        expect(getNormalizationLanguage('phonon-31m-en', 'de')).toBe('en');
    });
});
