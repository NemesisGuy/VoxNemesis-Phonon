# BUG Log

Concise history of regressions, fixes, and remaining checks.

## Open
- Manual integration sweep pending: first-run download overlay, cached reopen, context menu, playback in a store build.
- The CPU path has not been benchmarked against the WebGPU path on more than one machine.

## Upstream

- **The WebGPU path computes different numbers than the CPU, and the model is calibrated against the CPU's.** Reported to `gradium-ai/xn-ptts` as [issue #248](https://github.com/gradium-ai/xn-ptts/issues/248) and to `gradium-ai/xn` as [issue #123](https://github.com/NemesisGuy/xn/issues/123), with a prototype fix and the missing regression test on a branch.

  The CPU's q8 matmul quantises the **activations** to q8_0 before its integer dot, so it computes `d_w * sum(q_w * q_x)`. The WebGPU backend keeps the activations in f32 and dequantises the weights instead, so it computes `d_w * sum(q_w * x)`. Measured against an f64 reference, the CPU is off by 0.038 and the GPU by 1e-6 — **the GPU is the accurate one, and it is the one out of step with the model.**

  So the browser's WebGPU path is not running the model that was calibrated: the end-of-speech logit already differs on the first frame (−3.54 against −11.79, same seed and text), the generation diverges from there, the end-of-speech rule never fires, and the utterance runs to its full frame budget — exactly twice as long as it should be. From the second chunk on the latents go NaN, which is the noise.

  | text | CPU frames | WebGPU frames | NaN samples |
  |---|---:|---:|---:|
  | "Hello." | 17 | 34 | 0 |
  | 9 words | 47 | 105 | 0 |
  | 3 sentences | 291 | 568 | 504,960 |
  | 4 sentences | 385 | 768 | 1,474,560 |

  Nothing covered the q8 path: the parity tests in `xn` cover f32 matmul and the other ops, but not the q8 matmul, which is the one the models use.

  The native runtimes are unaffected — they have no WebGPU backend — and the CPU path is what the model was calibrated against, so the CPU is correct as it stands. The browser package should not ship the WebGPU path until the two agree.

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
