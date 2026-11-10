# pi-docent

**Persistent, read-only helper agents for [pi](https://github.com/earendil-works/pi), one per repo, that you can talk to directly.**

Working in repo A, the main agent often needs to understand repo B. Grepping blind is slow, and a one-shot subagent forgets everything when it finishes. pi-docent keeps a helper alive per repo for as long as the conversation needs it, and gives you a TUI to chat with any helper yourself, even while it works.

```
main agent ── helper_ask(repo, question) ──▶ helper for repo B   (in-process pi session, read-only)
                                               │ stays alive, keeps context across asks
you ── ctrl+n ──▶ overlay: live transcript + own input ──▶ same helper (idle or mid-run)
```

## Install

```sh
pi install git:github.com/liamleduy/pi-docent     # or a local path
pi -e ./src/index.ts                              # one-off, from a checkout
```

Needs pi >= 1.5 and Node >= 24. Zero runtime dependencies.

## How it works

- **Spawn on demand.** The first `helper_ask(repo, question)` for a path starts a helper session rooted at that repo. Later asks reuse it, so follow-ups are cheap. Ask several repos in parallel.
- **Lives while it's relevant.** A helper closes when the main agent calls `helper_close`, after 8 main-agent prompts without use (`PI_DOCENT_IDLE_PROMPTS`), or when pi exits, `/new`, `/resume` or `/reload` runs. Busy helpers are never reaped.
- **No new windows.** A widget above the editor lists helpers and what they are doing. **`ctrl+n`** (or `alt+h` where Option is Meta, or `/helpers [name]`) opens an overlay with the helper's live transcript and its own input. Message it while idle, or steer it mid-run.
- **Stay in sync.** If you talked to a helper directly, the main agent is told on its next turn.
- **Read-only.** Helpers get `read grep find ls` plus `bash` inside a kernel sandbox (macOS `sandbox-exec`, Linux `bwrap`): writes fail. No sandbox available means no bash.
- **The code is the truth.** Helpers research the real repo and cite `path:line`; they say "not found" rather than guess.

### Overlay keys

| Key | Action |
|---|---|
| `enter` | send to this helper |
| `esc` | back to main (helper keeps running) |
| `tab` | next helper |
| `ctrl+k` | abort its current run |
| `ctrl+x` | close this helper |
| `pgup` / `pgdn` | scroll |

| Env | Meaning |
|---|---|
| `PI_DOCENT_IDLE_PROMPTS` | main prompts a helper may go unused before auto-close, default 8 |

## Status and limitations

- Helpers use the main agent's model; no per-helper model override yet.
- The sandbox blocks all writes (including outside the repo, except tmp). No per-command allowlist.
- Not built yet: a knowledge vault that distills helper conversations into durable per-repo notes, and CLI commands. See the original Claude Code plugin, [docent](https://github.com/liamleduy/docent).

## Development

```sh
npm install
npm run typecheck
npm test
pi -e ./src/index.ts
```

TypeScript runs directly (pi loads extensions via jiti, tests via Node type stripping); only erasable syntax is allowed.

## License

MIT
