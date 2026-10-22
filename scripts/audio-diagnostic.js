// Audio diagnostic: generate speech through the real runtime and the real scheduling path,
// then write the WAVs out so the waveform can be inspected.
//
//   node scripts/audio-diagnostic.js
//
// The point is to tell two failures apart: audio the model produced badly, and audio the
// extension scheduled badly. The harness records both the raw chunks and what went into
// the AudioBuffer.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'voxnemesis-audio-diagnostic');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.css': 'text/css'
};

const TEXTS = [
    {
        label: 'short',
        text: 'On the morning of Wednesday 21 October 2026'
    },
    {
        label: 'long',
        text: 'On the morning of Wednesday 21 October 2026, the PHP project published an emergency security release fixing two critical remote code execution vulnerabilities in the language that runs a large share of the web. By 14:00 UTC the patches were live, Linux distributions had them in advance, and security agencies were telling operators to patch immediately or take their sites offline. If your site runs PHP, and if you run WordPress, it runs PHP, this is the week to check what you are actually serving.'
    }
];

function serve() {
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const file = path.join(ROOT, url === '/' ? '/scripts/audio-diagnostic.html' : url);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404);
            res.end('not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });

    const server = await serve();
    const port = server.address().port;
    console.log(`serving ${ROOT} on ${port}`);

    const context = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'voxnemesis-audio-diag'), {
        headless: false,
        args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run']
    });

    const page = await context.newPage();
    page.on('console', (msg) => console.log(`[page:${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => console.log(`[page:error] ${err.message}`));

    await page.goto(`http://127.0.0.1:${port}/scripts/audio-diagnostic.html`);
    console.log('harness loaded');

    for (const device of ['auto', 'cpu']) {
        console.log(`\n===== device: ${device} =====`);
        const result = await page.evaluate(
            async ([texts, dev]) => window.runDiagnostic(texts, dev),
            [TEXTS, device]
        );

        if (result.error) {
            console.log('ERROR:', result.error);
            continue;
        }

        console.log(`model sampleRate=${result.sampleRate} ctx.sampleRate=${result.ctxSampleRate} device=${result.engineDevice} threads=${result.threads}`);

        for (const run of result.runs) {
            console.log(`\n--- ${run.label} ---`);
            console.log(`  chunks=${run.chunkCount} lens=[${run.chunkLens.join(',')}]`);
            console.log(`  totalSamples=${run.totalSamples} duration=${run.durationSeconds.toFixed(2)}s`);
            console.log(`  firstAudioMs=${run.firstAudioMs} totalMs=${run.totalMs} modelChunks=${run.chunks}`);
            console.log(`  merged: ${JSON.stringify(run.mergedStats)}`);
            console.log(`  scheduledMismatch=${run.scheduledMismatch}`);
            run.rawStats.slice(0, 4).forEach((s, i) => console.log(`   chunk[${i}] ${JSON.stringify(s)}`));
            if (run.rawStats.length > 4) {
                const last = run.rawStats[run.rawStats.length - 1];
                console.log(`   chunk[last] ${JSON.stringify(last)}`);
            }

            const wav = Buffer.from(run.wav);
            fs.writeFileSync(path.join(OUT, `${device}-${run.label}.wav`), wav);
        }
    }

    console.log(`\nwrote WAVs to ${OUT}`);
    await context.close();
    server.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
