# BUG Log

Concise history of regressions, fixes, and remaining checks.

## Open
- Manual integration sweep pending: first-run download overlay, cached reopen, context menu, playback in a store build.
- The CPU path has not been benchmarked against the WebGPU path on more than one machine.

## Upstream

- **phonon-tts 0.4.1 corrupts audio on the WebGPU path.** Reported to `gradium-ai/xn-ptts`. The details are in `scripts/audio-diagnostic.js`, which reproduces it with no extension involved:

  | | WebGPU (`device: 'auto'`) | CPU (`device: 'cpu'`) |
  |---|---|---|
  | 9-word sentence | 8.40s, no NaN | 3.76s, no NaN |
  | 90-word paragraph | 61.44s, **888,960 NaN samples (60%)** | 30.80s, no NaN |

  The generation overshoots the model's frame budget and the overshoot comes back as NaN, which is a burst of noise in the middle of the utterance. The CPU path through the same code is clean. Until it is fixed, the extension defaults to the CPU and offers WebGPU as an opt-in.

## Recently Fixed

- **WebGPU audio was corrupted.** The extension defaulted to `device: 'auto'`, which picks WebGPU on a machine that has an adapter, so every long utterance came out as a burst of noise. The default is now the CPU. See Upstream.
- **The Play button was disabled on a fresh popup.** With nothing generated yet and no previous utterance, `derivePlaybackState` reported `canPlay: false`, so pressing Play did nothing. The popup now asks the page for its selection and enables Play when there is text to read.
- **The popup looked for the selection in the wrong tab.** `chrome.tabs.query` can return the extension's own page, which has no content script and cannot be scripted into. Both the popup and the background now skip extension pages.
- **Changing the device did nothing.** The device is baked into the loaded model, and the popup only saved it. Changing it now reloads the model.
- `getStatus` and `stop` never answered. The offscreen dispatcher called `.then()` on the handler's return value, and two of the handlers return a plain object rather than a promise. The dispatcher now wraps the result in `Promise.resolve`.
- A streamed utterance reported a negative playback position. `getCurrentTime` measured against `nextStartTime`, which is the end of the audio scheduled so far and moves with every chunk, instead of `startedAt`, which is when the playback began.
- The engine stayed busy forever after a streamed generation. The busy flag was set when the speech started and never cleared, so the second request was rejected with "the engine is busy" long after the first had finished.
- The engine reported no model id until one was set explicitly, because the initial load passed no model.
- `play` demanded text on the page even when the engine already had a clip. The background now asks the engine first and falls back to the selection only when the engine has nothing to play.

## Notes
- `npm test` passes (76 tests: helper, model registry, voice catalog, popup logic).
- The browser smoke test passes: the model loads on the CPU, streaming playback advances, a buffered clip generates and can be played, paused, resumed, seeked and stopped, a catalog voice downloads on first use, a long paragraph comes out at the right length, and the popup offers Play when the page has a selection.
- Branded Chrome 137 and newer ignore `--load-extension` and `--disable-extensions-except`. The smoke test uses Playwright's Chromium, which allows both. Loading unpacked through `chrome://extensions` is unaffected.
