const {
    VOICES,
    getVoiceUrl,
    findVoice,
    getVoicesForLanguage,
    describeVoice
} = require('../lib/voices.js');

describe('the voice catalog', () => {
    it('has voices', () => {
        expect(VOICES.length).toBeGreaterThan(50);
    });

    it('gives every voice the fields the extension needs', () => {
        VOICES.forEach((voice) => {
            expect(typeof voice.name).toBe('string');
            expect(typeof voice.voice_id).toBe('string');
            expect(voice.filename).toMatch(/^voices\/.+\.safetensors$/);
            expect(['en', 'fr', 'de', 'es', 'pt']).toContain(voice.language);
        });
    });

    it('has no two voices with the same name', () => {
        const names = VOICES.map((v) => v.name);
        expect(new Set(names).size).toBe(names.length);
    });
});

describe('getVoiceUrl', () => {
    it('points at the catalog file', () => {
        expect(getVoiceUrl('voices/ABC.safetensors')).toBe(
            'https://huggingface.co/gradium/phonon-voices/resolve/main/voices/ABC.safetensors'
        );
    });
});

describe('findVoice', () => {
    it('finds a voice by name', () => {
        const voice = findVoice('Easton');
        expect(voice).not.toBeNull();
        expect(voice.name).toBe('Easton');
    });

    it('finds a voice by id', () => {
        const voice = findVoice('LMDIYE0Oa377Qh6Z');
        expect(voice).not.toBeNull();
        expect(voice.name).toBe('Easton');
    });

    it('ignores case', () => {
        expect(findVoice('easton').name).toBe('Easton');
    });

    it('returns nothing for an unknown voice', () => {
        expect(findVoice('Nobody')).toBeNull();
        expect(findVoice('')).toBeNull();
    });
});

describe('getVoicesForLanguage', () => {
    it('filters by language', () => {
        const german = getVoicesForLanguage('de');
        expect(german.length).toBeGreaterThan(0);
        expect(german.every((v) => v.language === 'de')).toBe(true);
    });

    it('gives everything for none', () => {
        expect(getVoicesForLanguage('none').length).toBe(VOICES.length);
    });
});

describe('describeVoice', () => {
    it('names the locale and gender', () => {
        expect(describeVoice(findVoice('Easton'))).toContain('en-us');
    });

    it('is empty for nothing', () => {
        expect(describeVoice(null)).toBe('');
    });
});
