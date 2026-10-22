// VoxNemesis TTS (Phonon Edition) — background service worker.
//
// The worker is a router: the popup and the context menu send it commands, and it hands them
// to the offscreen document, which owns the model. It also owns the context menu, because the
// service worker is the only context that survives the popup closing.

let creating; // Promise to track offscreen creation
const CONTEXT_MENU_ID = 'phonon-read';

async function getSelectedText(tabId) {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { command: 'getSelection' });
        if (response && response.text) return response.text;
    } catch (err) {
        console.warn('Background: content script selection fallback failed', err);
    }

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => window.getSelection().toString()
        });
        if (results && results[0]) {
            return results[0].result;
        }
    } catch (err) {
        console.warn('Background: executeScript selection failed', err);
    }

    return '';
}

async function setupOffscreenDocument(path) {
    const offscreenUrl = chrome.runtime.getURL(path);

    try {
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [offscreenUrl]
        });

        if (existingContexts.length > 0) {
            return;
        }
    } catch (e) {
        console.warn('Background: error checking contexts, assuming none:', e);
    }

    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: path,
            reasons: ['AUDIO_PLAYBACK', 'BLOBS'],
            justification: 'Text to speech generation via WebAssembly',
        });
        await creating;
        creating = null;
    }
}

/** The text selected in the active tab, or an empty string. */
async function getActiveSelection() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0 || !tabs[0].id) return '';
    return getSelectedText(tabs[0].id);
}

function ensureContextMenu() {
    const create = () => {
        try {
            chrome.contextMenus.create({
                id: CONTEXT_MENU_ID,
                title: 'Read with VoxNemesis TTS (Phonon)',
                contexts: ['selection']
            });
        } catch (e) {
            console.warn('Background: context menu creation failed:', e);
        }
    };

    try {
        chrome.contextMenus.removeAll(() => {
            if (chrome.runtime.lastError) {
                console.warn('Background: context menu removeAll error:', chrome.runtime.lastError.message);
            }
            create();
        });
    } catch (e) {
        create();
    }
}

/** The settings the popup persists, which the context menu reuses. */
async function readSettings() {
    const stored = await chrome.storage.local.get([
        'selectedModel',
        'selectedVoiceName',
        'selectedLanguage',
        'speed',
        'volume',
        'seed',
        'temperature',
        'device'
    ]);

    return {
        voiceName: stored.selectedVoiceName || 'default',
        language: stored.selectedLanguage || 'en',
        speed: stored.speed ?? 1,
        volume: stored.volume ?? 1,
        seed: stored.seed ?? '',
        temperature: stored.temperature ?? 0.3,
        device: stored.device || 'auto'
    };
}

chrome.runtime.onInstalled.addListener(() => {
    setupOffscreenDocument('offscreen.html');
    ensureContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
    setupOffscreenDocument('offscreen.html');
    ensureContextMenu();
});

ensureContextMenu();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID) return;

    const text = info.selectionText || (tab ? await getSelectedText(tab.id) : '');
    if (!text) return;

    await setupOffscreenDocument('offscreen.html');
    const settings = await readSettings();

    chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'speak',
        text,
        modelId: (await chrome.storage.local.get(['selectedModel'])).selectedModel,
        settings,
        autoplay: true
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || request.target === 'offscreen') return undefined;

    (async () => {
        try {
            await setupOffscreenDocument('offscreen.html');

            const forward = (type, extra = {}) => new Promise((resolve) => {
                chrome.runtime.sendMessage({ target: 'offscreen', type, ...extra }, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ error: chrome.runtime.lastError.message });
                    } else {
                        resolve(response);
                    }
                });
            });

            if (request.command === 'play') {
                // Play whatever the engine already has. If it has nothing, fall back to the
                // selection on the page.
                const response = await forward('play');
                if (response && response.status === 'no_content') {
                    const text = await getActiveSelection();
                    if (!text) {
                        sendResponse({ status: 'no_text' });
                        return;
                    }
                    const settings = request.settings && Object.keys(request.settings).length
                        ? request.settings
                        : await readSettings();
                    sendResponse(await forward('speak', {
                        text,
                        modelId: request.modelId,
                        settings,
                        autoplay: true
                    }));
                    return;
                }
                sendResponse(response);
            } else if (request.command === 'speak') {
                let textToRead = request.text;

                if (!textToRead) {
                    textToRead = await getActiveSelection();
                }

                if (!textToRead) {
                    sendResponse({ status: 'no_text' });
                    return;
                }

                const settings = request.settings && Object.keys(request.settings).length
                    ? request.settings
                    : await readSettings();

                sendResponse(await forward('speak', {
                    text: textToRead,
                    modelId: request.modelId,
                    settings,
                    autoplay: request.autoplay !== false
                }));
            } else if (request.command === 'stop') {
                sendResponse(await forward('stop'));
            } else if (request.command === 'pause') {
                sendResponse(await forward('pause'));
            } else if (request.command === 'resume') {
                sendResponse(await forward('resume'));
            } else if (request.command === 'seek') {
                sendResponse(await forward('seek', { time: request.time }));
            } else if (request.command === 'getStatus') {
                const response = await forward('getStatus');
                sendResponse(response || { hasAudio: false });
            } else if (request.command === 'init') {
                sendResponse(await forward('init', { options: request.options || {} }));
            } else if (request.command === 'switchModel') {
                sendResponse(await forward('switchModel', { modelId: request.modelId, lang: request.lang }));
            }
        } catch (err) {
            console.error(err);
            sendResponse({ error: err.message });
        }
    })();

    return true;
});
