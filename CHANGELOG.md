# Changelog

## 0.1.2
- **Fixed: WebGPU produced corrupted audio.** The extension defaulted to `device: 'auto'`, which picks WebGPU on a machine with an adapter, and the current phonon-tts 0.4.1 WebGPU path overshoots the frame budget and returns the overshoot as NaN samples. Long utterances came out as a burst of noise. The default is now the CPU; WebGPU is an opt-in with a warning.
- Added `scripts/audio-diagnostic.js` and `scripts/analyse_audio.py`, which reproduce the upstream WebGPU bug outside the extension and measure the NaN runs.
- **Fixed: the Play button was disabled on a fresh popup.** The popup now checks the page for a selection and enables Play when there is text to read.
- **Fixed: the selection was looked for in the wrong tab.** Both the popup and the background skip extension pages when picking the active tab.
- **Fixed: changing the device did nothing.** The device is baked into the loaded model, so changing it now reloads the model.
- The smoke test now checks the length of a long generation, and that the popup finds the page's selection.

## 0.1.1
- Rebuilt the popup on the NemesisNet production palette: `brand-tokens.css` is vendored verbatim from the brand guide, and `style.css` consumes it.
- Dropped the Google Fonts request for the brand's system font stack. The extension now makes no third-party network request at all.
- Verified in Opera GX 136 as well as Chromium. The smoke test takes a `BROWSER_EXECUTABLE` environment variable.

## 0.1.0
- Initial release: VoxNemesis TTS (Phonon Edition).
- Gradium Phonon runs entirely in the browser through the `phonon-tts` wasm package, in a module worker inside an MV3 offscreen document.
- Model registry with the public `phonon-31m-en` checkpoint and the gated `phonon-40m-multilingual` one.
- Local checkpoint support: a checkpoint in `models/` is preferred over the Hub, so the extension runs with no network at all.
- 102 voices from the Gradium catalog, generated into `lib/voices.js` by `scripts/fetch-assets.js`, filtered by language and downloaded on first use.
- Two playback modes: streaming for immediacy, buffered for scrubbing, seeking and replaying.
- WebGPU when the browser offers a hardware adapter and the weights are q8 GGUF; WASM otherwise. The popup reports which one it got.
- Context menu entry: right-click selected text and read it aloud.
- Speed, volume, variation and seed controls, persisted in `chrome.storage.local` and shared across tabs.
- Jest suites for the helper, the model registry, the voice catalog and the popup logic; 74 tests.
- A Playwright smoke test that loads the unpacked extension in a real Chromium and exercises the whole engine.
