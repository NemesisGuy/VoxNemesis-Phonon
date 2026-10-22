// VoxNemesis TTS (Phonon Edition) — content script.
//
// Two jobs: hand the page's selection to the popup and the service worker, and offer a
// Web Speech fallback for the case where the Phonon model has not finished loading and the
// user wants to hear something now.

let currentUtterance = null;

function handlePlay(settings) {
    if ('speechSynthesis' in window) {
        if (window.speechSynthesis.paused && window.speechSynthesis.speaking) {
            window.speechSynthesis.resume();
            return;
        }

        const text = window.getSelection().toString();
        if (!text) return;

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = parseFloat(settings.rate) || 1;
        utterance.volume = parseFloat(settings.volume) || 1;
        currentUtterance = utterance;
        window.speechSynthesis.speak(utterance);
    }
}

function handlePause() {
    if ('speechSynthesis' in window) window.speechSynthesis.pause();
}

function handleStop() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    currentUtterance = null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || !request.command) return undefined;

    if (request.command === 'getSelection') {
        sendResponse({ text: window.getSelection().toString() });
        return false;
    }

    if (request.command === 'play') {
        handlePlay(request.settings || {});
        sendResponse({ status: 'playing' });
        return false;
    }

    if (request.command === 'pause') {
        handlePause();
        sendResponse({ status: 'paused' });
        return false;
    }

    if (request.command === 'stop') {
        handleStop();
        sendResponse({ status: 'stopped' });
        return false;
    }

    return undefined;
});

// Nudge the voice list into existence: some browsers fill it only after the first call.
if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
}
