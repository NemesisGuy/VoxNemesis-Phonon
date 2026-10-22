# VoxNemesis TTS (Phonon Edition)

A Chrome/Edge extension that runs Gradium's [Phonon](https://huggingface.co/gradium/phonon-31m-en) text-to-speech model entirely in the browser, on the user's own machine. The model is pulled from Hugging Face on first use, cached locally, and reused offline.

Phonon streams: the first audio arrives in tens of milliseconds, before the sentence is finished. 102 voices from the [Gradium voice catalog](https://huggingface.co/gradium/phonon-voices) ship with it.

## Features

- **Local-first TTS.** The model runs in a WebAssembly worker inside the browser. No server, no API key, no round trip.
- **Streaming playback.** Audio starts before the utterance is finished generating.
- **102 voices.** The Gradium catalog, filtered by language, plus the voices the checkpoint ships with.
- **Five languages.** English, French, German, Spanish and Portuguese, depending on the checkpoint.
- **WebGPU when the machine has it, WASM when it does not.** The extension picks and says which.
- **Scrubbing.** "Generate Audio" builds a clip you can play, pause, seek and replay. "Play" streams the selection straight away.
- **Context menu.** Right-click selected text, read it aloud.
- **Runs offline.** Drop the checkpoint into `models/` and the extension never touches the network again.

## Known Limitations

- **No voice cloning in the browser.** The wasm build has no encoder for turning a recording into an embedding. Only precomputed voices work. Voice cloning is available in the Phonon desktop runtimes and the Gradium Studio, not here.
- **The gated checkpoints cannot be downloaded by the extension.** A browser has no Hugging Face token to send, so the Phonon 40m repos are unreachable. They work from local files: see [Running a local checkpoint](#running-a-local-checkpoint).
- **Seeking a streamed utterance is approximate.** Phonon gives no word timings, so a seek in streaming mode restarts the generation from an approximate point in the text. A buffered clip seeks exactly.
- **One thread.** The wasm threads build needs a cross-origin isolated page, which a Chrome extension cannot have without giving up the cross-origin model downloads. The extension ships single-threaded and uses WebGPU where it can.
- **Speed and variation are conditioners, not dials.** Phonon has no rate or pitch knob. Speed maps to its `duration_delta` conditioner, which is a scale of its own; the mapping in `lib/helper.js` is deliberately conservative.

## Supported Models

| Model | Parameters | Weights | Languages | Licence |
|---|---|---:|---|---|
| [phonon-31m-en](https://huggingface.co/gradium/phonon-31m-en) | 31M | 64.5 MB | English | Apache-2.0 |
| [phonon-40m-multilingual](https://huggingface.co/gradium/phonon-40m-multilingual) | 40M | 74.6 MB | All five | CC BY-NC 4.0 |

The 31m checkpoint is public and downloads itself. The 40m checkpoints are gated and need local files.

The runtime is MIT OR Apache-2.0. The weights carry their own licences: 31m is Apache-2.0, 40m is CC BY-NC 4.0.

## How It Works

- The background service worker routes the popup and the context menu to an offscreen document, which is the only place with a DOM that outlives the popup.
- The offscreen document loads the `phonon-tts` package, which runs the model in a module worker. The wasm module never touches the main thread.
- Models and voices are fetched from Hugging Face on first use and kept in the Cache API. Later runs start from disk.
- WebGPU is used when the browser offers a hardware adapter and the weights are the q8 GGUF. Otherwise the model runs on the CPU. The popup says which one it got.
- Settings live in `chrome.storage.local` and are shared across every tab.

## Load the Extension (Chrome/Edge)

You do **not** need Node or npm to use the extension. The model downloads automatically inside the extension on first use.

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the repository root folder (`VoxNemesis-Phonon`).
4. Pin the extension if desired and open the popup to adjust settings.

> Chrome 137 and newer refuse `--load-extension` in branded builds. Loading unpacked through the extensions page still works. If you script the load, use Chromium or pass `--enable-unsafe-extension-debugging`.

## Usage

- Select the **Model**, the **Language** and the **Voice** from the popup.
- Select text on any page, then press **Play** to stream it, or **Generate Audio** to build a clip you can scrub and replay.
- **Speed** maps to Phonon's duration conditioner. **Variation** is the sampling temperature. **Seed** makes a run reproducible; leave it empty for a random one.
- Right-click selected text and choose **Read with VoxNemesis TTS (Phonon)**.

## Running a Local Checkpoint

Put a checkpoint in the extension's own `models/` folder and the extension prefers it over the Hub, which means the model works with no network at all:

```
models/phonon-31m-en/
  config.json
  tokenizer.json
  model.q8.gguf
  voices/            (optional)
```

The gated 40m checkpoints work the same way. Accept the licence on the model page first, then download the files into `models/phonon-40m-multilingual/`.

## Troubleshooting

- **Overlay stuck on first run:** the first run downloads about 64 MB. The popup watchdog hides the overlay once the engine reports itself ready. If it never does, the download failed; the overlay carries the error and a **Retry** button.
- **No sound, but the model is ready:** the browser blocked the audio. Click Play again — the offscreen document resumes its audio context on demand. In a headless test run, launch with `--autoplay-policy=no-user-gesture-required`.
- **WebGPU unavailable:** the engine falls back to the CPU automatically. It is slower and says so.
- **A catalog voice will not speak:** the voice file is downloaded the first time it is used. If the download failed, the engine reports it; try the voice again.
- **Context menu missing:** reload the extension. The service worker recreates the menu on install, on startup and on wake.
- **The 40m model refuses to load:** it is gated and the browser cannot authenticate. Download it manually into `models/`.

## Privacy

- Text and audio stay on the machine. Nothing is sent anywhere.
- The only network requests are the model and voice files from Hugging Face, and they are cached afterwards.
- A local checkpoint in `models/` removes the network requests entirely.

## Development

- Requirements: Node 18+ (for the tests and the voice generator only).
- `npm install`, then `npm test` for the unit tests.
- `node scripts/smoke-test.js` loads the extension in a real Chromium and exercises the whole engine. It needs Playwright available; set `PLAYWRIGHT_PATH` if it is not on the default resolution path.
- `npm run fetch:voices` regenerates `lib/voices.js` from the Gradium catalog.
- The upstream runtime is vendored in `lib/phonon-tts/`. It is not modified. To move to a new version, replace the folder and read its README again — the API moves.

### Test Coverage (quick map)

- `tests/helper.test.js` — the speed mapping, the seek arithmetic, the seed check, the local model spec.
- `tests/models.test.js` — the model registry and the language rules.
- `tests/voices.test.js` — the voice catalog and the lookup.
- `tests/popup.logic.test.js` — the overlay state, the voice list, the playback state, the timeline.
- `scripts/smoke-test.js` — the real thing: Chromium, the wasm worker, the Cache API, the audio clock.

## Folder Layout

- `lib/phonon-tts/` — the vendored upstream runtime, with the wasm builds.
- `lib/models.js` — the model registry: models, languages, licences.
- `lib/voices.js` — the generated voice catalog.
- `lib/helper.js` — pure helpers shared by the engine and the popup.
- `background.js` — the service worker: the router and the context menu.
- `offscreen.html`, `offscreen.js` — the engine: the model, the Web Audio graph, the generation.
- `popup.html`, `popup.js`, `popup.logic.js`, `style.css` — the controls.
- `content.js` — the page selection and the Web Speech fallback.
- `scripts/` — the voice generator and the browser smoke test.
- `tests/` — the Jest suites.
- `models/` — optional local checkpoints.

## Notes

- Keep the `wasm-unsafe-eval` CSP entry. Without it the wasm module does not compile.
- The wasm package is vendored on purpose: the extension must work with no CDN and no build step.
- The extension pages are the only thing that runs. There is no server and no telemetry.

## Release Packaging

Bump `manifest.json` and `package.json` together, run `npm test` and the smoke test, then package:

```
git archive -o release/voxnemesis-phonon-extension-<ver>.zip HEAD
```

Upload the zip to the Chrome/Edge store and smoke-test the store build: first-run download, cached reopen, context menu, playback.

## Manual Test Sweep (recommended before publish)

1. First run: load unpacked, open the popup, confirm the overlay shows the download and then hides by itself.
2. Cached reopen: close and reopen the popup, confirm the overlay stays hidden and the model is ready.
3. Speak: select text on a page, press Play, confirm audio starts within a second.
4. Generate: press Generate Audio, confirm the timeline fills and the clip can be played and scrubbed.
5. Voices: pick two different catalog voices, confirm each speaks.
6. Speed: set 0.5x and 2.0x, confirm the speech is slower and faster.
7. Context menu: highlight page text, right-click, confirm the read-aloud item appears and works.
8. Offline: disconnect the network, reload the extension, confirm the cached model still loads.
9. CPU fallback: switch the device to CPU, confirm playback still works.
