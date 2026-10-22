# BUG Log

Concise history of regressions, fixes, and remaining checks.

## Open
- Manual integration sweep pending: first-run download overlay, cached reopen, context menu, playback in a store build.
- The CPU path has not been benchmarked against the WebGPU path on more than one machine.

## Recently Fixed
- `getStatus` and `stop` never answered. The offscreen dispatcher called `.then()` on the handler's return value, and two of the handlers return a plain object rather than a promise. The dispatcher now wraps the result in `Promise.resolve`.
- A streamed utterance reported a negative playback position. `getCurrentTime` measured against `nextStartTime`, which is the end of the audio scheduled so far and moves with every chunk, instead of `startedAt`, which is when the playback began.
- The engine stayed busy forever after a streamed generation. The busy flag was set when the speech started and never cleared, so the second request was rejected with "the engine is busy" long after the first had finished.
- The engine reported no model id until one was set explicitly, because the initial load passed no model.
- `play` demanded text on the page even when the engine already had a clip. The background now asks the engine first and falls back to the selection only when the engine has nothing to play.

## Notes
- `npm test` passes (74 tests: helper, model registry, voice catalog, popup logic).
- The browser smoke test passes: the model loads on WebGPU, streaming playback advances, a buffered clip generates and can be played, paused, resumed, seeked and stopped, and a catalog voice downloads on first use.
- Branded Chrome 137 and newer ignore `--load-extension` and `--disable-extensions-except`. The smoke test uses Playwright's Chromium, which allows both. Loading unpacked through `chrome://extensions` is unaffected.
