// Smoke test: load the unpacked extension in Chrome and see whether the engine comes up.
//
//   node scripts/smoke-test.js
//
// Prints what the popup and the offscreen engine report, and every console error, so a
// broken build is obvious without opening a browser by hand.

const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'voxnemesis-phonon-smoke');

async function main() {
    fs.rmSync(PROFILE, { recursive: true, force: true });

    const context = await chromium.launchPersistentContext(PROFILE, {
        headless: false,
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--enable-unsafe-extension-debugging',
            '--autoplay-policy=no-user-gesture-required'
        ]
    });

    const logs = [];
    context.on('console', (msg) => logs.push(`[console:${msg.type()}] ${msg.text()}`));
    context.on('weberror', (err) => logs.push(`[weberror] ${err.error().message}`));

    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extensionId = new URL(worker.url()).host;
    console.log(`extension id: ${extensionId}`);

    const page = await context.newPage();
    page.on('console', (msg) => logs.push(`[popup:${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[popup:error] ${err.message}`));

    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    console.log('popup opened');

    // The engine loads the model on the offscreen document, which downloads it the first
    // time. Watch the status line until it settles.
    const deadline = Date.now() + 240000;
    let last = '';
    let settled = false;
    while (Date.now() < deadline) {
        const text = await page.textContent('#statusMessage').catch(() => null);
        const hidden = await page.evaluate(() => document.getElementById('fetchOverlay').classList.contains('hidden'));
        const line = `status="${text}" overlayHidden=${hidden}`;
        if (line !== last) {
            console.log(line);
            last = line;
        }
        if (hidden && text && /Model ready/i.test(text)) {
            settled = true;
            break;
        }
        await page.waitForTimeout(2000);
    }

    if (settled) {
        console.log('--- streaming ---');
        const streamed = await page.evaluate(async () => {
            const send = (message) => new Promise((resolve) => {
                chrome.runtime.sendMessage(message, (response) => resolve(
                    chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : response
                ));
            });
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));

            const response = await send({
                command: 'speak',
                text: 'Phonon is running entirely inside the browser, with no server and no cloud.',
                autoplay: true
            });

            const samples = [];
            for (let i = 0; i < 12; i += 1) {
                await wait(500);
                const status = await send({ command: 'getStatus' });
                samples.push({
                    playing: status.isPlaying,
                    currentTime: Number((status.currentTime || 0).toFixed(2)),
                    duration: Number((status.duration || 0).toFixed(2)),
                    mode: status.mode
                });
                if (!status.isPlaying && samples.length > 1) break;
            }
            return { response, samples };
        });

        console.log('speak response:', JSON.stringify(streamed.response));
        streamed.samples.forEach((s) => console.log('  ', JSON.stringify(s)));
        const advanced = streamed.samples.some((s) => s.currentTime > 0);

        console.log('--- buffered generate, playback controls and a catalog voice ---');
        const controls = await page.evaluate(async () => {
            const send = (message) => new Promise((resolve) => {
                chrome.runtime.sendMessage(message, (response) => resolve(
                    chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : response
                ));
            });
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const out = {};

            await send({ command: 'stop' });
            await wait(300);

            out.generate = await send({
                command: 'speak',
                text: 'A buffered clip can be scrubbed and replayed.',
                autoplay: false
            });
            out.afterGenerate = await send({ command: 'getStatus' });

            out.play = await send({ command: 'play' });
            await wait(600);
            out.afterPlay = await send({ command: 'getStatus' });

            out.pause = await send({ command: 'pause' });
            await wait(300);
            out.afterPause = await send({ command: 'getStatus' });

            out.resume = await send({ command: 'resume' });
            await wait(600);
            out.afterResume = await send({ command: 'getStatus' });

            out.seek = await send({ command: 'seek', time: 1.0 });
            await wait(400);
            out.afterSeek = await send({ command: 'getStatus' });

            out.stop = await send({ command: 'stop' });
            await wait(300);
            out.afterStop = await send({ command: 'getStatus' });

            // A voice from the Gradium catalog: it has to be downloaded on first use.
            out.catalogSpeak = await send({
                command: 'speak',
                text: 'This is Easton.',
                settings: { voiceName: 'Easton', language: 'en', speed: 1, volume: 1 },
                autoplay: true
            });
            await wait(2500);
            out.afterCatalog = await send({ command: 'getStatus' });

            await send({ command: 'stop' });
            return out;
        });

        Object.entries(controls).forEach(([key, value]) => {
            console.log(`  ${key}: ${JSON.stringify(value)}`);
        });

        const catalogWorked = controls.catalogSpeak && !controls.catalogSpeak.error;
        const controlsWorked = controls.afterGenerate
            && controls.afterGenerate.hasAudio
            && controls.afterPause
            && controls.afterPause.isPaused;

        console.log('--- console output ---');
        logs.forEach((line) => console.log(line));

        const ok = advanced && controlsWorked && catalogWorked;
        console.log(`RESULT: model=${settled} stream=${advanced} controls=${Boolean(controlsWorked)} catalogVoice=${catalogWorked}`);
        await context.close();
        process.exit(ok ? 0 : 1);
    }

    console.log('--- console output ---');
    logs.forEach((line) => console.log(line));

    console.log('RESULT: the model did not load within the time allowed');
    await context.close();
    process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
