// VoxNemesis TTS (Phonon Edition) — popup.
//
// The popup holds no model and no audio. It reads and writes the settings, asks the service
// worker to run the engine, and draws what the offscreen engine reports.

import {
    deriveOverlayState,
    buildVoiceList,
    voiceLabel,
    languagesForModel,
    derivePlaybackState,
    timelineLabels
} from './popup.logic.js';
import { MODELS, MODEL_IDS, DEFAULT_MODEL, getModel } from './lib/models.js';
import { findVoice } from './lib/voices.js';

(() => {
    const el = {};

    let isDragging = false;
    let currentModelId = DEFAULT_MODEL;
    let status = null;
    let overlayGuardInterval = null;

    function cacheElements() {
        [
            'modelSelect', 'languageSelect', 'voiceSelect', 'deviceSelect',
            'speedRange', 'speedValue', 'volumeRange', 'volumeValue',
            'temperatureRange', 'temperatureValue', 'seedInput',
            'generateBtn', 'playBtn', 'pauseBtn', 'stopBtn',
            'statusMessage', 'loader', 'progressBar', 'currentTime', 'duration',
            'fetchOverlay', 'overlayText', 'overlayRetry', 'modelNote'
        ].forEach((id) => {
            el[id] = document.getElementById(id);
        });
    }

    // ------------------------------------------------------------ lists

    function populateModelSelect(selectedId) {
        el.modelSelect.innerHTML = '';
        MODEL_IDS.forEach((id) => {
            const model = MODELS[id];
            const option = document.createElement('option');
            option.value = id;
            option.textContent = model.name;
            el.modelSelect.appendChild(option);
        });
        el.modelSelect.value = selectedId && MODEL_IDS.includes(selectedId) ? selectedId : DEFAULT_MODEL;
        updateModelNote(el.modelSelect.value);
    }

    function updateModelNote(modelId) {
        const model = getModel(modelId);
        const parts = [model.license];
        if (model.gated) parts.push('gated on the Hub — needs local files');
        el.modelNote.textContent = parts.join(' · ');
    }

    function populateLanguageSelect(modelId, selectedCode) {
        const languages = languagesForModel(modelId);
        el.languageSelect.innerHTML = '';
        languages.forEach((language) => {
            const option = document.createElement('option');
            option.value = language.code;
            option.textContent = language.name;
            el.languageSelect.appendChild(option);
        });
        if (selectedCode && languages.some((l) => l.code === selectedCode)) {
            el.languageSelect.value = selectedCode;
        }
    }

    function populateVoiceList(modelVoices, selectedVoiceName) {
        const names = buildVoiceList(modelVoices, el.languageSelect.value);
        el.voiceSelect.innerHTML = '';
        names.forEach((name) => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = voiceLabel(name);
            el.voiceSelect.appendChild(option);
        });

        const wanted = selectedVoiceName || 'default';
        if (names.includes(wanted)) {
            el.voiceSelect.value = wanted;
        } else if (names.length > 0) {
            el.voiceSelect.value = names[0];
        }
    }

    // ------------------------------------------------------------ settings

    function saveSettings() {
        chrome.storage.local.set({
            selectedModel: el.modelSelect.value,
            selectedLanguage: el.languageSelect.value,
            selectedVoiceName: el.voiceSelect.value,
            speed: parseFloat(el.speedRange.value),
            volume: parseFloat(el.volumeRange.value),
            temperature: parseFloat(el.temperatureRange.value),
            seed: el.seedInput.value,
            device: el.deviceSelect.value
        });
    }

    async function loadSettings() {
        const stored = await chrome.storage.local.get([
            'selectedModel', 'selectedLanguage', 'selectedVoiceName',
            'speed', 'volume', 'temperature', 'seed', 'device'
        ]);

        currentModelId = stored.selectedModel && MODEL_IDS.includes(stored.selectedModel)
            ? stored.selectedModel
            : DEFAULT_MODEL;

        populateModelSelect(currentModelId);
        populateLanguageSelect(currentModelId, stored.selectedLanguage);

        if (stored.speed !== undefined) el.speedRange.value = stored.speed;
        if (stored.volume !== undefined) el.volumeRange.value = stored.volume;
        if (stored.temperature !== undefined) el.temperatureRange.value = stored.temperature;
        if (stored.seed !== undefined) el.seedInput.value = stored.seed;
        if (stored.device !== undefined) el.deviceSelect.value = stored.device;

        updateSliderLabels();
        populateVoiceList([], stored.selectedVoiceName);
    }

    function updateSliderLabels() {
        el.speedValue.textContent = parseFloat(el.speedRange.value).toFixed(2);
        el.volumeValue.textContent = parseFloat(el.volumeRange.value).toFixed(2);
        el.temperatureValue.textContent = parseFloat(el.temperatureRange.value).toFixed(2);
    }

    // ------------------------------------------------------------ messaging

    function sendCommand(command, extraParams = {}) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ command, ...extraParams }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ error: chrome.runtime.lastError.message });
                } else {
                    resolve(response || {});
                }
            });
        });
    }

    async function refreshStatus() {
        const response = await sendCommand('getStatus');
        if (response && !response.error) {
            status = response;
            updateUIState(response);
        }
        return status;
    }

    // ------------------------------------------------------------ ui

    function updateStatus(text, options = {}) {
        el.statusMessage.textContent = text;
        el.statusMessage.classList.toggle('error', Boolean(options.isError));
    }

    function updateUIState(next) {
        status = next || {};
        const playback = derivePlaybackState(status);
        const labels = timelineLabels(status);

        el.playBtn.disabled = !playback.canPlay;
        el.pauseBtn.disabled = !playback.canPause;
        el.stopBtn.disabled = !playback.canStop;
        el.playBtn.classList.toggle('active', Boolean(status.isPlaying));

        el.currentTime.textContent = labels.current;
        el.duration.textContent = labels.duration;
        if (!isDragging) {
            el.progressBar.value = status.duration > 0
                ? Math.min(100, (status.currentTime / status.duration) * 100)
                : 0;
        }

        if (!status.isPlaying && !status.isPaused) updateStatus(playback.label);
    }

    function showOverlay(text, isError) {
        el.overlayText.textContent = text;
        el.fetchOverlay.classList.remove('hidden');
        el.overlayRetry.classList.toggle('hidden', !isError);
        el.loader.classList.remove('hidden');
    }

    function hideOverlay(statusText) {
        el.fetchOverlay.classList.add('hidden');
        el.loader.classList.add('hidden');
        if (statusText) updateStatus(statusText);
    }

    function handleAssetStatus(msg) {
        const overlay = deriveOverlayState(msg);
        if (overlay.action === 'show') {
            showOverlay(overlay.text, overlay.isError);
            if (overlay.isError) {
                hideOverlay(null);
                updateStatus(overlay.text, { isError: true });
                stopOverlayGuard();
            }
        } else if (overlay.action === 'hide') {
            hideOverlay(overlay.text);
            stopOverlayGuard();
        }
    }

    // The popup can be opened after the engine reported itself ready, so the overlay is
    // polled for a while and hidden as soon as the engine says so.
    function startOverlayGuard() {
        stopOverlayGuard();
        overlayGuardInterval = setInterval(async () => {
            const current = await refreshStatus();
            if (current && (current.modelsReady || current.hasAudio)) {
                hideOverlay('Model ready.');
                stopOverlayGuard();
            }
        }, 2000);
    }

    function stopOverlayGuard() {
        if (overlayGuardInterval) {
            clearInterval(overlayGuardInterval);
            overlayGuardInterval = null;
        }
    }

    async function retryAssetDownload() {
        showOverlay('Retrying...', false);
        const response = await sendCommand('init', { options: { modelId: el.modelSelect.value } });
        if (response && response.error) {
            updateStatus(response.error, { isError: true });
        }
    }

    // ------------------------------------------------------------ actions

    async function handleGenerate() {
        saveSettings();
        el.loader.classList.remove('hidden');
        updateStatus('Generating...');

        const response = await sendCommand('speak', {
            text: await getSelectionText(),
            autoplay: false
        });

        el.loader.classList.add('hidden');

        if (response && response.error) {
            updateStatus(response.error, { isError: true });
            return;
        }
        await refreshStatus();
        updateStatus('Audio ready. Press play.');
    }

    async function handlePlayClick() {
        saveSettings();
        updateStatus('Generating...');
        const response = await sendCommand('play');
        if (response && response.error) {
            updateStatus(response.error, { isError: true });
            return;
        }
        await refreshStatus();
    }

    async function handlePauseClick() {
        const response = await sendCommand('pause');
        if (response && response.error) {
            updateStatus(response.error, { isError: true });
            return;
        }
        await refreshStatus();
        updateStatus('Paused');
    }

    async function handleStopClick() {
        const response = await sendCommand('stop');
        if (response && response.error) {
            updateStatus(response.error, { isError: true });
            return;
        }
        await refreshStatus();
        updateStatus('Stopped');
    }

    async function handleSeek() {
        const duration = status && status.duration ? status.duration : 0;
        const time = (parseFloat(el.progressBar.value) / 100) * duration;
        const response = await sendCommand('seek', { time });
        if (response && response.error) {
            updateStatus(response.error, { isError: true });
            return;
        }
        await refreshStatus();
    }

    async function getSelectionText() {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0 || !tabs[0].id) return '';
        try {
            const response = await chrome.tabs.sendMessage(tabs[0].id, { command: 'getSelection' });
            if (response && response.text) return response.text;
        } catch (err) {
            // The content script is not on this page; fall back to the scripting API.
        }
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: () => window.getSelection().toString()
            });
            return results && results[0] ? results[0].result : '';
        } catch (err) {
            return '';
        }
    }

    async function handleModelChange() {
        currentModelId = el.modelSelect.value;
        updateModelNote(currentModelId);
        populateLanguageSelect(currentModelId, el.languageSelect.value);
        populateVoiceList([], el.voiceSelect.value);
        saveSettings();

        showOverlay('Switching model...', false);
        const response = await sendCommand('switchModel', { modelId: currentModelId });
        if (response && response.error) {
            hideOverlay(null);
            updateStatus(response.error, { isError: true });
            return;
        }
        await refreshStatus();
    }

    function handleVoiceChange() {
        saveSettings();
        const entry = findVoice(el.voiceSelect.value);
        if (entry) {
            updateStatus(`${entry.name} — ${entry.description}`);
        }
    }

    // ------------------------------------------------------------ wiring

    function bindEvents() {
        el.modelSelect.addEventListener('change', handleModelChange);
        el.languageSelect.addEventListener('change', () => {
            populateVoiceList(status ? status.voices : [], el.voiceSelect.value);
            saveSettings();
        });
        el.voiceSelect.addEventListener('change', handleVoiceChange);
        el.deviceSelect.addEventListener('change', saveSettings);
        el.seedInput.addEventListener('change', saveSettings);

        ['speedRange', 'volumeRange', 'temperatureRange'].forEach((id) => {
            el[id].addEventListener('input', () => {
                updateSliderLabels();
                saveSettings();
            });
        });

        el.generateBtn.addEventListener('click', handleGenerate);
        el.playBtn.addEventListener('click', handlePlayClick);
        el.pauseBtn.addEventListener('click', handlePauseClick);
        el.stopBtn.addEventListener('click', handleStopClick);
        el.overlayRetry.addEventListener('click', retryAssetDownload);

        el.progressBar.addEventListener('pointerdown', () => {
            isDragging = true;
        });
        el.progressBar.addEventListener('pointerup', () => {
            isDragging = false;
            handleSeek();
        });
        el.progressBar.addEventListener('change', () => {
            if (isDragging) {
                isDragging = false;
                handleSeek();
            }
        });

        chrome.runtime.onMessage.addListener((msg) => {
            if (!msg || msg.target === 'offscreen') return;

            if (msg.type === 'assetStatus') {
                handleAssetStatus(msg);
            } else if (msg.type === 'progress') {
                status = { ...(status || {}), currentTime: msg.currentTime, duration: msg.duration || (status && status.duration) };
                updateUIState(status);
            } else if (msg.type === 'playing') {
                status = { ...(status || {}), isPlaying: true, isPaused: false, currentTime: msg.currentTime, duration: msg.duration };
                updateUIState(status);
            } else if (msg.type === 'playbackEnded') {
                status = { ...(status || {}), isPlaying: false, isPaused: false, currentTime: 0 };
                updateUIState(status);
                updateStatus('Playback finished.');
            } else if (msg.type === 'generationDone') {
                status = { ...(status || {}), hasAudio: true, duration: msg.duration };
                updateUIState(status);
                updateStatus('Audio ready. Press play.');
            }
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        cacheElements();
        bindEvents();
        await loadSettings();
        await refreshStatus();
        startOverlayGuard();
    });
})();
