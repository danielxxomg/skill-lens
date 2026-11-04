# skill-lens

Objective: show which skills are available and which were actually loaded, per session and per sub-agent, in OpenCode V2 and pi.
Branch: `main` (new repo, local only). Delivery: single-pr per work unit, no publish.
Test runner: `vitest` (core), adapter fixtures from real harness captures.

## Specs

S1 — Harnesses: OpenCode V2 (2.2.x) and pi (1.5.0). OpenCode V1 is out of scope because it has no TUI plugin API.

S2 — "Skills cargadas" means both sets, shown separately: `Available (N)` and `Used (M)`, with used ones marked inside the available list.

S3 — Usage detection counts three methods, each labeled: `tool` (tool named `skill`), `command` (`/skill:name` expansion), `read` (a `read`/`Read` tool call whose path ends in `SKILL.md`). Each carries a counter. Failed loads are marked, never hidden. Free-text mentions are NOT usage. pi 1.5.0 has no `skill` tool, so `read` is its primary method; `command` is observable only in pi's raw `input` event.

S4 — OpenCode surface: a session panel opened by the `/skills` command (fallback `/skill-lens` on collision) plus a statusline segment rendered as `skills <available>/<used>`.

S5 — pi surface: a widget above the editor with the same data, a matching short status line, and the `/skills` command (which opens a select dialog with the full detail: description, path, shadowed paths).

S6 — Sub-agents: family tree (parent -> children -> grandchildren) from the current session only, active runs first, history dimmed. Each node shows its used skills plus a diff against its parent: `+N/-M` with at most 3 names per side and "+N more"; `=` when the sets are identical.

S7 — Duplicates: one row per effective name, badge `xN`, with the winning path and the shadowed paths in the detail view. The harness's own precedence decides the winner.

S8 — Source of truth for available skills: OpenCode uses the location catalog (`location.skill.list()`), provenance `catalog`, because a real 2.2.5 session stores no skill block in its system message (verified on `/api/session/<id>/context`). pi uses `before_agent_start -> systemPromptOptions.skills`, provenance `pi`.

S9 — Live updates: refresh on harness events with a ~150 ms debounce, plus a recompute when the panel/widget opens.

S10 — No own ledger. History is whatever lives in each harness's session store; nothing is persisted by this plugin.

S11 — Monorepo layout: `packages/core` (pure model, no harness imports), `packages/opencode` (TUI-only plugin), `packages/pi` (extension). Local install by link, no npm publish.

S12 — Tests: vitest over `core`, with fixtures captured from both harnesses (including duplicate names and shadowed paths). Adapters are tested against captured data, not by mocking each harness end to end.

S13 — Acceptance: (1) core tests green, (2) live check in OpenCode V2 (panel + statusline) and in pi (widget) with a real `pi-subagents` run showing per-sub-agent skills, (3) README with installation for both, (4) no high-risk item touched: read-only state inspection.

Out of scope: OpenCode V1, OpenCode Desktop GUI, cross-session global view, any model-callable tool.

## Tasks

| ID | Spec | Route | Status | Commit |
|----|------|-------|--------|--------|
| T1 | S11, S12 | inline | done | af96a88 |
| T2 | S3, S7, S8 (core model + resolvers) | inline | done | af96a88 |
| T3 | S4, S6, S9 (OpenCode TUI adapter) | inline (serial, after T2) | done | 9c71a19 |
| T4 | S5, S6, S9 (pi extension) | inline (serial, after T2) | done | 267dd7f |
| T5 | S13 (README + install) | inline | done | 09358ce |

## Log

L1 — "Desarrollar un Plugin para Opencode, Opencode2, y pi.dev, para ver en el tab, las skills cargadas en el chat normal, y en los sub-agentes tambien."
L2 — Confirmed design round 1-3: both sections, V2 + pi only, session panel + statusline, family tree with diff, monorepo, detection tool/command/read, effective-name rows, 150 ms live updates, no ledger.
L3 — Repo goes to `~/Projects/skill-lens`, not inside `~/herramientas-generales`.
L4 — Audits of both installed APIs delegated (one per harness) using CodeGraph, preferring local checkouts: `herramientas-generales/opencode` (v2.2.5, already indexed) and `herramientas-generales/pi` (v1.5.0-159, index created).
L5 — pi audit: no `skill` tool in 1.5.0 (skills load via `read` of SKILL.md); skills come from `before_agent_start.systemPromptOptions.skills` or `ctx.getSystemPromptOptions()`; `pi-subagents@0.34.0` writes `os.tmpdir()/pi-subagents-<user>/async-subagent-runs/<id>/status.json` with parent `sessionId`, `steps[].skills` (names), `steps[].sessionFile`; no live cross-process events, so poll the file; clean timers in `session_shutdown`; string widgets are capped at 10 lines in the checkout build.
L6 — OpenCode audit: TUI plugins load only from directories referenced in `cli.json plugins` (a bare file entry is skipped); the host injects `@opencode/plugin`, so never bundle it; `SkillInfo` = id/name/description/autoinvoke/path/content (no scope); tool calls live inside `assistant.content[]`; `prompt.footer.status` receives `{sessionID?, mode, showDetails}`; `session.panel` receives `PanelInput`.
L7 — S8 rewritten after evidence: a real 2.2.5 session (`/tmp/ctx.json`, 64 messages) has a `system` message of 8971 chars with no skill block, so OpenCode availability comes from the catalog and is marked `catalog`.
L8 — Evidence: 40 vitest tests pass (core model, both adapters' pure logic, pi wiring with a fake host, OpenCode wiring through a stubbed injected module), `tsc --noEmit` clean. `opencode plugin list` resolves the directory entry; `pi -e packages/pi/index.ts --list-models` exits 0. Real TUI reload still pending on the user's side, which is the remaining part of S13.
