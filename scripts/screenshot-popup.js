#!/usr/bin/env node
// Captures the popup for the README.
//
//   node scripts/screenshot-popup.js
//
// Writes docs/popup.png. The model has to be loaded first, otherwise the overlay covers the
// controls, so the script waits for the engine to report itself ready.

const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'voxnemesis-phonon-shot');
const OUT = path.join(EXTENSION_PATH, 'docs', 'popup.png');

async function main() {
    fs.rmSync(PROFILE, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(OUT), { recursive: true });

    const context = await chromium.launchPersistentContext(PROFILE, {
        headless: false,
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--enable-unsafe-extension-debugging'
        ]
    });

    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extensionId = new URL(worker.url()).host;

    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
        const ready = await page.evaluate(() => {
            const overlay = document.getElementById('fetchOverlay');
            const status = document.getElementById('statusMessage');
            return overlay.classList.contains('hidden') && /ready/i.test(status.textContent || '');
        });
        if (ready) break;
        await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: OUT });
    console.log(`Wrote ${OUT}`);

    await context.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
