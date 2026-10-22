const {
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
    estimateDuration,
    DEFAULT_SEED
} = require('../lib/helper.js');

describe('clamp', () => {
    it('keeps a value inside its bounds', () => {
        expect(clamp(5, 0, 10)).toBe(5);
        expect(clamp(-5, 0, 10)).toBe(0);
        expect(clamp(50, 0, 10)).toBe(10);
    });
});

describe('speedToDurationDelta', () => {
    it('is zero at normal speed', () => {
        expect(speedToDurationDelta(1)).toBe(0);
    });

    it('is negative when the speech is faster', () => {
        expect(speedToDurationDelta(1.5)).toBeLessThan(0);
    });

    it('is positive when the speech is slower', () => {
        expect(speedToDurationDelta(0.5)).toBeGreaterThan(0);
    });

    it('clamps to the range the checkpoints accept', () => {
        expect(speedToDurationDelta(10)).toBeGreaterThanOrEqual(-0.8);
        expect(speedToDurationDelta(0.01)).toBeLessThanOrEqual(0.8);
    });

    it('falls back to normal speed for nonsense', () => {
        expect(speedToDurationDelta('fast')).toBe(0);
        expect(speedToDurationDelta(undefined)).toBe(0);
    });
});

describe('buildConditions', () => {
    it('leaves the conditioner out at normal speed', () => {
        expect(buildConditions({ speed: 1 })).toEqual({});
    });

    it('carries the duration delta at other speeds', () => {
        const conditions = buildConditions({ speed: 1.5 });
        expect(Object.keys(conditions)).toEqual(['duration_delta']);
        expect(conditions.duration_delta).toBeLessThan(0);
    });
});

describe('buildLocalModelSpec', () => {
    const resolve = (p) => `chrome-extension://abc/${p}`;

    it('points every part of the checkpoint at the extension folder', () => {
        const spec = buildLocalModelSpec('phonon-31m-en', resolve);
        expect(spec.config).toBe('chrome-extension://abc/models/phonon-31m-en/config.json');
        expect(spec.tokenizer).toBe('chrome-extension://abc/models/phonon-31m-en/tokenizer.json');
        expect(spec.weights.q8).toBe('chrome-extension://abc/models/phonon-31m-en/model.q8.gguf');
    });

    it('refuses a model with no local folder', () => {
        expect(() => buildLocalModelSpec('nope', resolve)).toThrow();
    });
});

describe('resolveLanguage', () => {
    it('keeps a language the model speaks', () => {
        expect(resolveLanguage('phonon-40m-multilingual', 'fr')).toBe('fr');
    });

    it('falls back when the model does not speak it', () => {
        expect(resolveLanguage('phonon-31m-en', 'fr')).toBe('en');
        expect(resolveLanguage('phonon-31m-en', undefined)).toBe('en');
    });
});

describe('splitIntoSentences', () => {
    it('splits on sentence marks', () => {
        const parts = splitIntoSentences('One. Two! Three?');
        expect(parts.length).toBe(3);
    });

    it('keeps the trailing whitespace with its sentence', () => {
        const parts = splitIntoSentences('One. Two.');
        expect(parts[0].trim()).toBe('One.');
    });

    it('returns nothing for nothing', () => {
        expect(splitIntoSentences('')).toEqual([]);
        expect(splitIntoSentences(null)).toEqual([]);
    });
});

describe('offsetForTime', () => {
    const text = 'One. Two. Three. Four.';

    it('starts at the beginning', () => {
        expect(offsetForTime(text, 0, 10)).toBe(0);
    });

    it('lands later in the text the further in the audio', () => {
        const early = offsetForTime(text, 1, 10);
        const late = offsetForTime(text, 9, 10);
        expect(late).toBeGreaterThan(early);
    });

    it('never runs past the end', () => {
        expect(offsetForTime(text, 100, 10)).toBeLessThan(text.length);
    });

    it('is zero when the duration is unknown', () => {
        expect(offsetForTime(text, 5, 0)).toBe(0);
    });
});

describe('textFromOffset', () => {
    it('cuts the text at the offset', () => {
        expect(textFromOffset('Hello world', 6)).toBe('world');
    });

    it('clamps an offset outside the text', () => {
        expect(textFromOffset('Hello', 99)).toBe('o');
        expect(textFromOffset('Hello', -5)).toBe('Hello');
    });
});

describe('normalizeSeed', () => {
    it('uses the runtime default when nothing is given', () => {
        expect(normalizeSeed('')).toBe(DEFAULT_SEED);
        expect(normalizeSeed(null)).toBe(DEFAULT_SEED);
        expect(normalizeSeed(undefined)).toBe(DEFAULT_SEED);
    });

    it('accepts a number inside the range', () => {
        expect(normalizeSeed(123)).toBe(123n);
    });

    it('accepts a numeric string', () => {
        expect(normalizeSeed('123')).toBe(123n);
    });

    it('refuses a value outside the range', () => {
        expect(normalizeSeed(-1)).toBeNull();
        expect(normalizeSeed('abc')).toBeNull();
    });
});

describe('formatTime', () => {
    it('formats seconds as m:ss', () => {
        expect(formatTime(0)).toBe('0:00');
        expect(formatTime(9)).toBe('0:09');
        expect(formatTime(65)).toBe('1:05');
    });

    it('survives nonsense', () => {
        expect(formatTime(NaN)).toBe('0:00');
        expect(formatTime(-4)).toBe('0:00');
    });
});

describe('estimateDuration', () => {
    it('grows with the text', () => {
        const short = estimateDuration('Hello there.');
        const long = estimateDuration('Hello there. '.repeat(10));
        expect(long).toBeGreaterThan(short);
    });

    it('is shorter at a higher speed', () => {
        expect(estimateDuration('Hello there.', 2)).toBeLessThan(estimateDuration('Hello there.', 1));
    });

    it('is zero for no text', () => {
        expect(estimateDuration('')).toBe(0);
    });
});
