// VoxNemesis TTS (Phonon Edition) — offscreen engine.
//
// The offscreen document is the only place with a DOM that outlives the popup, so it owns the
// model, the Web Audio graph and the generation. The popup and the service worker talk to it
// over chrome.runtime messages.
//
// Two playback modes, because Phonon streams and the two jobs are different:
//
//   'streaming' — generate and play at the same time. The first audio arrives in
//                  milliseconds, which is the whole point of the model. Playback cannot be
//                  scrubbed, and a pause or a seek restarts the generation from an offset in
//                  the text.
//   'buffered'  — generate the whole utterance into an AudioBuffer first. Slower to start,
//                  but it can be scrubbed, replayed and paused exactly.
//
// The popup's "Generate Audio" produces a buffered clip; "Play" streams, unless a buffered
// clip is already there.

import { PhononTTS } from './lib/phonon-tts/index.js';
import { getModel, getNormalizationLanguage, requiresLocalFiles, DEFAULT_MODEL } from './lib/models.js';
import { findVoice, getVoiceUrl } from './lib/voices.js';
import {
    buildConditions,
    buildLocalModelSpec,
    estimateDuration,
    normalizeSeed,
    offsetForTime,
    resolveLanguage,
    textFromOffset
} from './lib/helper.js';

const RUNTIME_DIR = 'lib/phonon-tts';

const state = {
    tts: null,
    modelId: DEFAULT_MODEL,
    lang: 'en',
    device: 'auto',
    quant: 'q8',
    ready: false,
    loading: false,
    busy: false,

    audioContext: null,
    gain: null,

    mode: 'idle',
    stream: null,
    abortController: null,
    buffer: null,
    source: null,
    nextStartTime: 0,
    startedAt: 0,
    startOffset: 0,
    duration: 0,
    currentTime: 0,
    playing: false,
    paused: false,

    lastText: '',
    lastSettings: {},
    addedVoices: new Set(),
    progressTimer: null,
    stats: null,

    // Why a generation was cut short: 'pause', 'stop' or null.
    cancelReason: null,
    // Bumped for every generation, so a stale one cannot touch the state of a newer one.
    generationId: 0,
    // The position a paused streaming generation was stopped at.
    pausedAt: 0,
    pausedDuration: 0
};

const isTestEnv = typeof process !== 'undefined' && Boolean(process.env && process.env.JEST_WORKER_ID);

/** A path inside the extension as an absolute URL the worker can fetch. */
function runtimeUrl(path) {
    return chrome.runtime.getURL(path);
}

/** The wasm builds, addressed explicitly: the worker would otherwise resolve them itself. */
function wasmUrls() {
    return {
        wasmUrl: runtimeUrl(`${RUNTIME_DIR}/wasm/phonon_tts_bg.wasm`),
        simdWasmUrl: runtimeUrl(`${RUNTIME_DIR}/wasm/phonon_tts_simd_bg.wasm`),
        threadsWasmUrl: runtimeUrl(`${RUNTIME_DIR}/wasm-threads/phonon_tts_bg.wasm`),
        threadsSimdWasmUrl: runtimeUrl(`${RUNTIME_DIR}/wasm-threads/phonon_tts_simd_bg.wasm`)
    };
}

// ---------------------------------------------------------------- messaging

function sendRuntimeMessage(message) {
    try {
        chrome.runtime.sendMessage(message, () => {
            // Reading lastError is what stops Chrome logging "Unchecked runtime.lastError"
            // when nothing is listening, which is the normal case with the popup closed.
            void chrome.runtime.lastError;
        });
    } catch (err) {
        console.warn('Offscreen: could not deliver a message', err);
    }
}

function sendAssetStatus(phase, message, extra = {}) {
    sendRuntimeMessage({ type: 'assetStatus', phase, message, ...extra });
}

// ---------------------------------------------------------------- audio

function getAudioContext(sampleRate) {
    if (!state.audioContext) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        state.audioContext = new Ctor({ sampleRate: sampleRate || 24000 });
    }
    if (!state.gain) {
        state.gain = state.audioContext.createGain();
        state.gain.gain.value = 1;
        state.gain.connect(state.audioContext.destination);
    }
    return state.audioContext;
}

async function resumeAudio() {
    const ctx = state.audioContext;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
        try {
            await ctx.resume();
        } catch (err) {
            console.warn('Offscreen: could not resume the audio context', err);
        }
    }
}

function setVolume(volume) {
    if (!state.gain) return;
    const value = Number.isFinite(Number(volume)) ? Math.min(Math.max(Number(volume), 0), 2) : 1;
    state.gain.gain.value = value;
}

function stopProgressTimer() {
    if (state.progressTimer) {
        clearInterval(state.progressTimer);
        state.progressTimer = null;
    }
}

function startProgressTimer() {
    stopProgressTimer();
    state.progressTimer = setInterval(() => {
        if (state.playing) {
            sendRuntimeMessage({
                type: 'progress',
                currentTime: getCurrentTime(),
                duration: state.duration
            });
        }
    }, 100);
}

// ---------------------------------------------------------------- playback

function getCurrentTime() {
    const ctx = state.audioContext;
    if (!ctx) return state.currentTime;
    if (state.mode === 'buffered') {
        if (!state.playing) return state.currentTime;
        return Math.min(state.startOffset + (ctx.currentTime - state.startedAt), state.duration);
    }
    if (state.mode === 'streaming') {
        if (!state.playing) return state.currentTime;
        // `startedAt` is when the playback began on the audio clock. `nextStartTime` is the
        // end of the audio scheduled so far, which moves forward with every chunk and is
        // therefore not a reference for the current position.
        return Math.min(state.startOffset + (ctx.currentTime - state.startedAt), state.duration);
    }
    return state.currentTime;
}

/**
 * Tear the playback down.
 *
 * `keepBuffer` leaves a generated clip in place so it can be played again; everything else is
 * always cleared.
 */
function stopPlayback({ keepBuffer = false } = {}) {
    stopProgressTimer();

    if (state.stream) {
        try {
            state.stream.cancel();
        } catch (err) {
            console.warn('Offscreen: could not cancel the stream', err);
        }
        state.stream = null;
    }
    if (state.abortController) {
        state.abortController.abort();
        state.abortController = null;
    }
    if (state.source) {
        try {
            state.source.stop();
        } catch (err) {
            // A source that already ended cannot be stopped again.
        }
        state.source.disconnect();
        state.source = null;
    }

    state.playing = false;
    state.paused = false;
    state.mode = 'idle';
    state.nextStartTime = 0;
    state.startedAt = 0;
    state.startOffset = 0;
    state.currentTime = 0;

    if (!keepBuffer) {
        state.buffer = null;
        state.duration = 0;
    }
}

/** Schedule a PCM chunk on the audio clock. */
function scheduleChunk(ctx, pcm) {
    const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
    buffer.copyToChannel(pcm, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(state.gain);
    const startAt = Math.max(state.nextStartTime, ctx.currentTime);
    source.start(startAt);
    state.nextStartTime = startAt + buffer.duration;
}

// ---------------------------------------------------------------- model

async function localFolderExists(modelId) {
    const folder = getModel(modelId).localFolder;
    if (!folder) return false;
    try {
        const response = await fetch(runtimeUrl(`${folder}/config.json`));
        return response.ok;
    } catch (err) {
        return false;
    }
}

async function resolveModelSource(modelId) {
    const model = getModel(modelId);

    if (requiresLocalFiles(modelId)) {
        const hasLocal = await localFolderExists(modelId);
        if (!hasLocal) {
            throw new Error(
                `${model.name} is gated on Hugging Face and a browser cannot authenticate to a ` +
                'gated repo. Accept the licence on the model page, download the checkpoint ' +
                `files into the extension's "${model.localFolder}" folder (config.json, ` +
                'tokenizer.json, model.q8.gguf), and reload the extension.'
            );
        }
        return buildLocalModelSpec(modelId, runtimeUrl);
    }

    // The public checkpoint can also be run from a local copy, which is how a user gets a
    // fully offline extension.
    if (await localFolderExists(modelId)) {
        return buildLocalModelSpec(modelId, runtimeUrl);
    }
    return model.repo;
}

async function initEngine(options = {}) {
    if (state.loading) return { ready: state.ready };
    if (state.ready && (!options.modelId || options.modelId === state.modelId)) {
        return { ready: true, modelId: state.modelId };
    }

    state.loading = true;
    sendAssetStatus('start', 'Loading the Phonon model...');

    try {
        if (state.tts) {
            state.tts.dispose();
            state.tts = null;
        }
        state.ready = false;
        state.modelId = options.modelId || state.modelId;
        state.device = options.device || state.device;
        state.quant = options.quant || state.quant;

        const source = await resolveModelSource(state.modelId);
        const lang = resolveLanguage(state.modelId, options.lang || state.lang);

        sendAssetStatus('download', 'Downloading the checkpoint from Hugging Face...');

        const tts = await PhononTTS.load({
            lang,
            model: source,
            quant: state.quant,
            device: state.device,
            workerUrl: runtimeUrl(`${RUNTIME_DIR}/worker.js`),
            ...wasmUrls(),
            onProgress: ({ file, loaded, total, cached }) => {
                const percent = total ? Math.round((loaded / total) * 100) : null;
                sendAssetStatus(
                    'download',
                    `${file}${percent !== null ? ` ${percent}%` : ''}${cached ? ' (cached)' : ''}`,
                    { file, status: cached ? 'cached' : 'downloading', loaded, total }
                );
            }
        });

        state.tts = tts;
        state.lang = lang;
        state.ready = true;
        state.addedVoices = new Set(tts.voices);

        sendAssetStatus('ready', `Model ready on ${tts.device} (${tts.threads} thread(s)).`);
        return {
            ready: true,
            modelId: state.modelId,
            device: tts.device,
            deviceReason: tts.deviceReason,
            threads: tts.threads,
            threadsReason: tts.threadsReason,
            sampleRate: tts.sampleRate,
            languages: tts.languages,
            voices: tts.voices
        };
    } catch (err) {
        state.ready = false;
        const message = err && err.message ? err.message : String(err);
        sendAssetStatus('error', message);
        throw err;
    } finally {
        state.loading = false;
    }
}

/** Make sure a voice is loaded: the checkpoint's own, or one from the catalog. */
async function ensureVoice(voiceName) {
    if (!state.tts) throw new Error('the engine is not initialized');
    const name = voiceName || 'default';
    if (state.tts.voices.includes(name)) return name;

    const entry = findVoice(name);
    if (!entry) {
        throw new Error(
            `unknown voice '${name}'. The checkpoint's own voices and the Gradium catalog are available.`
        );
    }
    await state.tts.addVoice(entry.name, getVoiceUrl(entry.filename));
    state.addedVoices.add(entry.name);
    return entry.name;
}

// ---------------------------------------------------------------- synthesis

/**
 * Start speaking.
 *
 * A buffered generation is awaited: the caller asked for a file, so it waits for it. A
 * streamed one is not: the caller asked for a voice, and the progress events carry it from
 * there.
 */
async function speak(text, settings = {}, options = {}) {
    if (!state.ready) await initEngine({ modelId: options.modelId });
    if (state.busy) throw new Error('the engine is busy. Wait for the current utterance to finish.');

    const trimmed = (text || '').trim();
    if (!trimmed) throw new Error('there is no text to speak');

    const autoplay = options.autoplay !== false;
    let prepared;

    try {
        const voice = await ensureVoice(settings.voiceName);
        const seed = normalizeSeed(settings.seed);
        if (seed === null) throw new Error('the seed must be a whole number from 0 to 2^64 - 1');

        const speed = Number(settings.speed) || 1;
        const conditions = buildConditions({ speed });
        const lang = resolveLanguage(state.modelId, settings.language);

        // A language change needs a model that was loaded with it.
        if (lang !== state.lang) {
            await initEngine({ modelId: state.modelId, lang });
        }

        stopPlayback();
        state.lastText = trimmed;
        state.lastSettings = { ...settings, language: lang, speed };

        const ctx = getAudioContext(state.tts.sampleRate);
        setVolume(settings.volume);

        prepared = { ctx, voice, seed, temperature: settings.temperature, conditions };
    } catch (err) {
        throw err;
    }

    state.busy = true;

    if (!autoplay) {
        const generationId = ++state.generationId;
        try {
            await generateBuffered(prepared.ctx, trimmed, prepared.voice, prepared, generationId);
            return { ok: true, duration: state.duration, mode: state.mode, stats: state.stats };
        } finally {
            if (generationId === state.generationId) state.busy = false;
        }
    }

    // Streamed: the call returns at once and the progress events carry it.
    const generationId = ++state.generationId;
    const generation = generateStreaming(prepared.ctx, trimmed, prepared.voice, prepared, generationId);
    state.generation = generation;
    generation.then(
        () => {
            if (generationId === state.generationId) state.busy = false;
        },
        () => {
            if (generationId === state.generationId) state.busy = false;
        }
    );
    return { ok: true, duration: estimateDuration(trimmed, prepared.speed), mode: 'streaming' };
}

/**
 * Drop the running generation.
 *
 * Bumping the id makes the old one stale, so it cannot touch the state of whatever replaces
 * it, and the busy flag is cleared because nothing is running any more.
 */
function invalidateGeneration() {
    state.generationId += 1;
    state.busy = false;
    state.cancelReason = null;
}

/** Generate the whole utterance into an AudioBuffer. */
async function generateBuffered(ctx, text, voice, options, generationId) {
    const chunks = [];
    let total = 0;
    const controller = new AbortController();
    state.abortController = controller;

    const speech = state.tts.stream(text, {
        voice,
        temperature: options.temperature,
        seed: options.seed,
        signal: controller.signal
    });
    state.stream = speech;

    for await (const pcm of speech) {
        chunks.push(pcm);
        total += pcm.length;
        state.currentTime = total / ctx.sampleRate;
        sendRuntimeMessage({ type: 'progress', currentTime: state.currentTime, duration: 0 });
    }

    state.stats = await speech.done.catch(() => null);
    if (generationId === state.generationId) {
        state.stream = null;
        state.abortController = null;
    }

    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }

    const buffer = ctx.createBuffer(1, merged.length, ctx.sampleRate);
    buffer.copyToChannel(merged, 0);
    state.buffer = buffer;
    state.duration = merged.length / ctx.sampleRate;
    state.currentTime = 0;
    state.mode = 'buffered';

    sendRuntimeMessage({ type: 'generationDone', duration: state.duration, stats: state.stats });
}

/** Generate and play at the same time. */
async function generateStreaming(ctx, text, voice, options, generationId) {
    const controller = new AbortController();
    state.abortController = controller;

    const speech = state.tts.stream(text, {
        voice,
        temperature: options.temperature,
        seed: options.seed,
        signal: controller.signal
    });
    state.stream = speech;
    state.mode = 'streaming';
    state.duration = estimateDuration(text, state.lastSettings.speed);
    state.startOffset = 0;

    await resumeAudio();
    state.nextStartTime = ctx.currentTime;
    state.startedAt = ctx.currentTime;
    state.playing = true;
    state.paused = false;
    state.currentTime = 0;

    startProgressTimer();
    sendRuntimeMessage({ type: 'playing', currentTime: 0, duration: state.duration });

    let received = 0;
    try {
        for await (const pcm of speech) {
            scheduleChunk(ctx, pcm);
            received += pcm.length;
            state.duration = Math.max(state.duration, received / ctx.sampleRate);
        }
    } catch (err) {
        if (generationId === state.generationId) {
            sendAssetStatus('error', err && err.message ? err.message : String(err));
            stopPlayback({ keepBuffer: false });
        }
        return;
    }

    state.stats = await speech.done.catch(() => null);

    // A newer generation has taken over: this one has nothing left to say about the state.
    if (generationId !== state.generationId) return;

    state.stream = null;
    state.abortController = null;

    const reason = state.cancelReason;
    state.cancelReason = null;

    if (reason === 'pause') {
        // The generation was cut short on purpose and the position was kept.
        state.playing = false;
        state.paused = true;
        state.mode = 'streaming';
        state.currentTime = state.pausedAt;
        state.duration = state.pausedDuration;
        stopProgressTimer();
        return;
    }

    if (reason === 'stop' || (state.stats && state.stats.cancelled)) {
        stopPlayback({ keepBuffer: false });
        sendRuntimeMessage({ type: 'playbackEnded', cancelled: true });
        return;
    }

    // The last chunk is still queued on the audio clock; wait it out before calling it done.
    const remaining = state.nextStartTime - ctx.currentTime;
    if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining * 1000 + 40));
    }
    if (generationId !== state.generationId) return;

    state.playing = false;
    state.paused = false;
    state.currentTime = state.duration;
    stopProgressTimer();
    sendRuntimeMessage({ type: 'playbackEnded', duration: state.duration });
}

/** Play what is there: the buffered clip, or a fresh streaming generation. */
async function play() {
    if (!state.ready) await initEngine({});
    if (state.playing && !state.paused) return { status: 'playing' };

    if (state.mode === 'buffered' && state.buffer) {
        const ctx = getAudioContext(state.tts.sampleRate);
        setVolume(state.lastSettings.volume);
        await resumeAudio();

        if (state.source) {
            try {
                state.source.stop();
            } catch (err) {
                // Already stopped.
            }
            state.source.disconnect();
        }

        const source = ctx.createBufferSource();
        source.buffer = state.buffer;
        source.connect(state.gain);
        source.onended = () => {
            if (state.source !== source) return;
            state.playing = false;
            state.paused = false;
            state.currentTime = 0;
            state.startOffset = 0;
            stopProgressTimer();
            sendRuntimeMessage({ type: 'playbackEnded' });
        };
        source.start(0, state.currentTime);

        state.source = source;
        state.startedAt = ctx.currentTime;
        state.startOffset = state.currentTime;
        state.playing = true;
        state.paused = false;
        startProgressTimer();
        sendRuntimeMessage({ type: 'playing', currentTime: state.currentTime, duration: state.duration });
        return { status: 'playing' };
    }

    if (!state.lastText) return { status: 'no_content' };
    await speak(state.lastText, state.lastSettings, { autoplay: true });
    return { status: 'playing' };
}

async function pause() {
    if (!state.playing || state.paused) return { status: state.paused ? 'paused' : 'stopped' };

    state.currentTime = getCurrentTime();
    state.pausedAt = state.currentTime;
    state.pausedDuration = state.duration;
    state.playing = false;
    state.paused = true;

    if (state.mode === 'streaming') {
        // A streamed utterance cannot be held still: the generation would run ahead of the
        // audio clock. It is cancelled and the position is kept, so a resume starts again
        // from that point in the text.
        state.cancelReason = 'pause';
        if (state.stream) {
            try {
                state.stream.cancel();
            } catch (err) {
                console.warn('Offscreen: could not cancel the stream', err);
            }
        }
        if (state.abortController) {
            state.abortController.abort();
            state.abortController = null;
        }
        stopProgressTimer();
    } else if (state.audioContext && state.audioContext.state === 'running') {
        await state.audioContext.suspend();
    }

    return { status: 'paused', currentTime: state.currentTime };
}

async function resume() {
    if (!state.paused) return { status: state.playing ? 'playing' : 'stopped' };

    state.paused = false;

    if (state.mode === 'streaming') {
        // Pick the text up where the audio stopped and generate it again.
        const offset = offsetForTime(state.lastText, state.currentTime, state.duration);
        const remaining = textFromOffset(state.lastText, offset);
        const ctx = getAudioContext(state.tts.sampleRate);
        state.buffer = null;
        invalidateGeneration();
        await speak(remaining, state.lastSettings, { autoplay: true });
        return { status: 'playing' };
    }

    if (state.audioContext) await resumeAudio();
    state.playing = true;
    state.startedAt = state.audioContext.currentTime;
    startProgressTimer();
    sendRuntimeMessage({ type: 'playing', currentTime: state.currentTime, duration: state.duration });
    return { status: 'playing' };
}

function stop() {
    invalidateGeneration();
    stopPlayback({ keepBuffer: false });
    state.lastText = '';
    state.lastSettings = {};
    return { status: 'stopped' };
}

/** Seek. Exact in the buffered mode, an approximation in the streamed one. */
async function seek(seconds) {
    const target = Number(seconds);
    if (!Number.isFinite(target) || target < 0) throw new Error('the seek position must be a number');

    if (state.mode === 'buffered' && state.buffer) {
        const ctx = getAudioContext(state.tts.sampleRate);
        const clamped = Math.min(target, state.duration);
        if (state.source) {
            try {
                state.source.stop();
            } catch (err) {
                // Already stopped.
            }
            state.source.disconnect();
            state.source = null;
        }
        state.currentTime = clamped;
        if (state.playing || state.paused) {
            const source = ctx.createBufferSource();
            source.buffer = state.buffer;
            source.connect(state.gain);
            source.onended = () => {
                if (state.source !== source) return;
                state.playing = false;
                state.paused = false;
                stopProgressTimer();
                sendRuntimeMessage({ type: 'playbackEnded' });
            };
            source.start(0, clamped);
            state.source = source;
            state.startedAt = ctx.currentTime;
            state.startOffset = clamped;
            state.playing = true;
            state.paused = false;
            startProgressTimer();
        }
        return { status: 'seeking', currentTime: clamped, exact: true };
    }

    if (state.mode === 'streaming' && state.lastText) {
        const offset = offsetForTime(state.lastText, target, state.duration);
        const remaining = textFromOffset(state.lastText, offset);
        invalidateGeneration();
        stopPlayback({ keepBuffer: false });
        state.currentTime = target;
        const ctx = getAudioContext(state.tts.sampleRate);
        await speak(remaining, state.lastSettings, { autoplay: true });
        return { status: 'seeking', currentTime: target, exact: false };
    }

    state.currentTime = target;
    return { status: 'seeking', currentTime: target, exact: false };
}

function getStatus() {
    return {
        hasAudio: Boolean(state.buffer),
        isPlaying: state.playing,
        isPaused: state.paused,
        mode: state.mode,
        currentTime: getCurrentTime(),
        duration: state.duration,
        modelsReady: state.ready,
        currentModelId: state.modelId,
        language: state.lang,
        device: state.tts ? state.tts.device : null,
        threads: state.tts ? state.tts.threads : null,
        sampleRate: state.tts ? state.tts.sampleRate : 24000,
        voices: state.tts ? state.tts.voices : [],
        lastText: state.lastText
    };
}

// ---------------------------------------------------------------- dispatch

const handlers = {
    init: (msg) => initEngine(msg.options || {}),
    switchModel: async (msg) => {
        const next = msg.modelId;
        if (!next || next === state.modelId) return { ready: state.ready };
        state.modelId = next;
        state.ready = false;
        stopPlayback({ keepBuffer: false });
        return initEngine({ modelId: next, lang: msg.lang, device: msg.device });
    },
    speak: (msg) => speak(msg.text, msg.settings || {}, { autoplay: msg.autoplay, modelId: msg.modelId }),
    play: () => play(),
    pause: () => pause(),
    resume: () => resume(),
    stop: () => stop(),
    seek: (msg) => seek(msg.time),
    getStatus: () => getStatus(),
    addVoice: async (msg) => {
        const name = await ensureVoice(msg.voiceName);
        return { voice: name, voices: state.tts.voices };
    }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target !== 'offscreen') return undefined;
    const handler = handlers[msg.type];
    if (!handler) {
        sendResponse({ error: `unknown offscreen command '${msg.type}'` });
        return false;
    }

    // Some handlers answer with a plain value rather than a promise.
    Promise.resolve(handler(msg)).then(
        (value) => sendResponse(value),
        (err) => sendResponse({ error: err && err.message ? err.message : String(err) })
    );
    return true;
});

// The model is loaded once and kept: the offscreen document lives as long as the browser does.
initEngine({}).catch((err) => {
    console.warn('Offscreen: the model could not be loaded yet', err && err.message);
});
