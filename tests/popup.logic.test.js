const {
    deriveOverlayState,
    buildVoiceList,
    voiceLabel,
    languagesForModel,
    derivePlaybackState,
    timelineLabels
} = require('../popup.logic.js');

describe('deriveOverlayState', () => {
    it('does nothing without a message', () => {
        expect(deriveOverlayState(null).action).toBe('noop');
    });

    it('does nothing for a message aimed at the offscreen engine', () => {
        expect(deriveOverlayState({ target: 'offscreen', phase: 'ready' }).action).toBe('noop');
    });

    it('shows the overlay while the model loads', () => {
        const state = deriveOverlayState({ phase: 'start' });
        expect(state.action).toBe('show');
        expect(state.isError).toBe(false);
    });

    it('shows the file being downloaded', () => {
        const state = deriveOverlayState({ phase: 'download', file: 'weights', status: 'downloading' });
        expect(state.action).toBe('show');
        expect(state.text).toContain('weights');
    });

    it('says cached when the file was already there', () => {
        const state = deriveOverlayState({ phase: 'download', file: 'weights', status: 'cached' });
        expect(state.text).toContain('cached');
    });

    it('hides the overlay when the model is ready', () => {
        expect(deriveOverlayState({ phase: 'ready' }).action).toBe('hide');
    });

    it('marks a failure as an error', () => {
        const state = deriveOverlayState({ phase: 'error', message: 'no network' });
        expect(state.action).toBe('show');
        expect(state.isError).toBe(true);
        expect(state.text).toBe('no network');
    });
});

describe('buildVoiceList', () => {
    it('includes the voices the checkpoint ships with', () => {
        const list = buildVoiceList(['default'], 'en');
        expect(list).toContain('default');
    });

    it('includes the catalog voices', () => {
        const list = buildVoiceList([], 'en');
        expect(list).toContain('Easton');
    });

    it('filters the catalog by language', () => {
        const list = buildVoiceList([], 'de');
        expect(list.length).toBeGreaterThan(0);
        expect(list).not.toContain('Easton');
    });

    it('does not repeat a voice', () => {
        const list = buildVoiceList(['Easton'], 'en');
        expect(list.filter((v) => v === 'Easton').length).toBe(1);
    });
});

describe('voiceLabel', () => {
    it('names the locale for a catalog voice', () => {
        expect(voiceLabel('Easton')).toContain('en-us');
    });

    it('says where a checkpoint voice comes from', () => {
        expect(voiceLabel('default')).toContain('checkpoint');
    });
});

describe('languagesForModel', () => {
    it('gives one language for the English model', () => {
        expect(languagesForModel('phonon-31m-en').map((l) => l.code)).toEqual(['en']);
    });

    it('gives five for the multilingual model', () => {
        expect(languagesForModel('phonon-40m-multilingual')).toHaveLength(5);
    });
});

describe('derivePlaybackState', () => {
    it('is idle with no status', () => {
        const state = derivePlaybackState(null);
        expect(state.canPlay).toBe(false);
        expect(state.label).toBe('Ready to read');
    });

    it('offers pause while playing', () => {
        const state = derivePlaybackState({ isPlaying: true });
        expect(state.canPause).toBe(true);
        expect(state.canPlay).toBe(false);
    });

    it('offers play while paused', () => {
        const state = derivePlaybackState({ isPaused: true });
        expect(state.canPlay).toBe(true);
        expect(state.canPause).toBe(false);
    });

    it('offers play when there is a buffered clip', () => {
        const state = derivePlaybackState({ hasAudio: true });
        expect(state.canPlay).toBe(true);
        expect(state.label).toContain('ready');
    });

    it('offers play when a streamed utterance is waiting', () => {
        const state = derivePlaybackState({ mode: 'streaming', lastText: 'hello' });
        expect(state.canPlay).toBe(true);
    });
});

describe('timelineLabels', () => {
    it('formats both ends of the timeline', () => {
        const labels = timelineLabels({ currentTime: 65, duration: 125 });
        expect(labels.current).toBe('1:05');
        expect(labels.duration).toBe('2:05');
    });

    it('survives no status', () => {
        expect(timelineLabels(null).current).toBe('0:00');
    });
});
