# skill-lens

See which skills are **available** and which were **actually loaded** — in the main chat and in every sub-agent — for OpenCode V2 and pi.

```
skills 55/3
[x] grilling (read 2)
[x] go-testing (tool 1)
[ ] 52 available without use
-- subagents (2)
  explore · running · 12 loaded +2/-1
  worker  · done    · 12 loaded =
```

## What it shows

- **Available** — every skill the harness would advertise for the session, with scope (`global`, `project`, `package`) and a `xN` badge when the same name exists in more than one root (the shadowed paths live in the detail view).
- **Used** — every skill that was really loaded, with the method that loaded it:
  - `tool` — a call to a `skill` tool (OpenCode).
  - `read` — a `read` of a `SKILL.md` file (pi 1.5.0 has no `skill` tool; this is how the model loads skills there).
  - `command` — a `/skill:name` expansion (pi).
  - Failed loads are marked with `!N`, never hidden.
- **Sub-agents** — the session family tree from the current session, running runs first, each with its own loaded set, its **own used skills with counts**, and a `+N/-M` diff against the parent (`=` when identical). OpenCode reads this exactly from each child session's tool calls; pi joins each run's assistant `toolCall` blocks with its `toolResult` entries by call id, cached by file mtime so the poll stays cheap.

Nothing is persisted: the plugin reads the harness's own session state every time.

## Install — OpenCode V2 (2.2.x)

TUI-only plugin. Add the **directory** (not a file) to `cli.json`:

```json
{
  "plugins": [
    "/absolute/path/to/skill-lens/packages/opencode"
  ]
}
```

Reload the TUI. Then:

- `/skills` (or `/skill-lens`) opens the **Skill Lens** panel for the current session, with sections, paths and shadowed duplicates.
- The session **sidebar** shows `skills <available>/<used>` with a proportional bar, next to context, quota and MCP.

The package must not bundle `@opencode/plugin`: the host injects it and refuses a foreign copy. That is why the monorepo has no runtime dependency on it.

## Install — pi (1.5.0)

Add the extension directory to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["/absolute/path/to/skill-lens/packages/pi"]
}
```

Reload with `/reload`. Then:

- A widget above the editor shows the same summary, refreshed live (150 ms debounce).
- `/skills` opens a select list with the full detail: scope, path, shadowed paths, description.
- `Ctrl+Shift+S` redraws the widget.

Sub-agent runs come from `pi-subagents`: `status.json` under `os.tmpdir()/pi-subagents-*/async-subagent-runs/<id>/`, filtered by the parent session id. The poll runs every 1.5 s and is cleared on `session_shutdown`.

## Layout

```
packages/core      pure model: effective skills, usage aggregation, session tree, diffs
packages/opencode  TUI-only plugin (sidebar + panel + /skills)
packages/pi        pi extension (widget + status + /skills)
```

`packages/*` import `core` by relative path so both hosts can load the sources in place.

## Development

```sh
npm install
npm test          # vitest: core, adapters' pure model, wiring with fake hosts
npm run typecheck
```

The adapters are exercised against fake hosts, not by mocking a whole harness. The live check is loading them in each TUI.

## Limitations

- OpenCode availability comes from the location catalog, not from the session prompt: a 2.2.5 session stores no skill block in its system message (verified), so per-session availability cannot be read from the transcript.
- pi exposes only the **winning** skill in `systemPromptOptions`, so shadowed duplicates cannot be shown there. OpenCode has the full catalog and does show them.
- pi sub-agent skills are the set loaded into that run (`status.json.steps[].skills`); the counts come from joining that run's `toolCall` and `toolResult` entries. Without a session file the row falls back to the loaded set.
- pi does not store the original `/skill:` command once expanded, so a resumed session restores `read`/`tool` loads but not command loads.
- Duplicate-name fixtures are hand-built from the harness shapes; there is no real captured session with collisions to assert against.
- OpenCode V1 has no TUI plugin API and is out of scope.

## License

MIT © danielxxomg
