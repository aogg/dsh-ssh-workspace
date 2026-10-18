# Peer stubs

`tests/peer-stubs.mjs` generates a minimal `node_modules` tree standing in for the
DSH peer packages this plugin borrows at load time:

| package | what the stub provides |
| --- | --- |
| `@deepseek-ai/dsh-fs` | `FsError` (with `code`), `FsTargetKey`, `FsVersion`, `FileSystem` |
| `@deepseek-ai/dsh-tools` | `defineTool` (shape-checking pass-through) |
| `ssh2` | `Client` whose constructor throws — it never pretends to speak SSH |

`tests/run.mjs` builds it automatically when `DSH_CORE_ROOT` is unset, so a bare
checkout exercises `routes.js` and `remote-fs.js` instead of skipping them.

## Why this exists

`routes.js` imports `remote-fs.js`, which resolves `@deepseek-ai/dsh-fs` at module
load. Without that package the suite SKIPPED — and a skipped suite cannot fail.
One such skip is how an upload handler that called two unimported helpers shipped
green. The stub root closes that hole for the plugin's own logic.

## What the stubs deliberately do NOT cover

These suites need the host's real framework and still skip without it:

| suite | needs | why a stub cannot help |
| --- | --- | --- |
| `lifecycle` | `@deepseek-ai/cordis` | exercises real service ordering and re-injection |
| `boot` | Cordis + real `dsh-fs`/`dsh-tools` | boots a real Cordis application |
| `tool-schemas` | real `dsh-tools` | the enforced JSON-Schema subset and argument validator |

Each calls `skipWithoutRealPeers()` (`tests/support/peer-mode.mjs`), which detects
the stub via its `__dshStub` marker and exits 0 with a reason. That is honest: the
suite reports "nothing to run" rather than "everything passed".

`live` and `acceptance` likewise skip without `DSH_WS_TEST_ALIAS` — no stub can
fake an SSH server.

## Opting out

```
DSH_NO_PEER_STUBS=1 node tests/run.mjs
```

The generated tree lives at `tests/.peer-stubs/` and is not published
(`package.json` ships only `lib/`, `cordis.patch.yml` and `README.md`).
