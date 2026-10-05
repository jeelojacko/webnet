# Pi Workflow — Reproducibility Requirements (WebNet)

Tracked companion to the gitignored project `.pi/APPEND_SYSTEM.md` (force-added
in this repo so a fresh clone has the routing policy; machine-local Pi state
below must be replicated by hand or script — see checklist).

## Default route

orchestrator → one `worker` → independent `reviewer` → exact-head CI.
Scout/Researcher/Oracle are opt-in only (unknown scope / external authority /
genuine dispute). Reviewer is read-only, never delegates, never reruns heavy
suites. Fixes go orchestrator → worker → reviewer recheck.

## Role/tool/delegation matrix (enforced in `~/.pi/agent/agents/*.md`)

| Role | Default? | May delegate? | FFF | Codemode | LSP | Graft | Web |
|---|---|---|---|---|---|---|---|
| orchestrator (parent) | yes | yes (scoped) | yes | yes | diagnostics | opt-in deep route | via researcher |
| worker | yes | no (no scout/researcher fan-out) | yes | yes | TS full set | NO (removed) | no |
| reviewer | per phase | NO | yes | yes | NO (removed) | NO (removed) | no |
| scout | opt-in | no | yes | yes | NO (removed) | yes (deep route) | no |
| researcher | opt-in | no | yes | yes | NO (removed) | NO (removed) | yes |
| oracle | disabled | no | n/a | n/a | n/a | n/a | n/a |

Graft canonical MCP names: `graft_find_code`, `graft_trace_calls`,
`graft_find_all`, `graft_file_api`, `graft_repo_map`,
`graft_check_freshness` (bare prefix per `graft --help` MCP section).
LSP servers start lazily per edited scope (`.pi/lsp.json`): TS normally,
clangd only on C++ edits — no extra gating needed.

## Model/provider assignments (verified)

- First worker: pinned default `opencode-go/muse-spark-1.3-contributor`, no override.
- DEFAULT is one worker. Extra parallel workers only for genuinely independent,
  substantial scopes where wall-time savings clearly exceed coordination cost
  (never for discovery, small fan-out, or bounded fixes):
  `commandcode/deepseek/deepseek-v4.1-flash` on high reasoning (smoke-proven;
  requires `$CMD_API_KEY`).
- NEVER use `opencode-go/deepseek/*`: opencode-go carries Muse Spark, not
  DeepSeek (HTTP 400). Retries stay on the original model.
- OpenAI models always via `openai-codex/<model>` (Codex auth).

## Required / disabled extensions

- Removed from defaults: Ponytail (+ all `ponytail*` skills/mentions),
  `pi-analytics`, browser extension (moved to `extensions-removed/`, not
  deleted — re-enable deliberately for live exploratory browser work).
- Kept: Codemode + FFF (default repo reading/search/filtering route), pi-lsp, pi-web-access
  (Researcher-first), statusline. Context Mode package stays installed for its
  MCP bridge; `ctx_*` memory/search/index is rare/opt-in, while `ctx_*`
  batch/shell may be used when materially more ergonomic for bounded shell
  batching (never giant recursive output; keep FTS exclusions).

## Validation fast-path

While editing: LSP + focused tests. Checkpoint: affected tests. Commit: Husky
lint + typecheck (never run them manually just before the hook). Before PR:
`test:agent` once. Build if production-affecting; browser validation via the project's existing Playwright/shell workflow only if UI changed (Pi browser extension opt-in only);
after reviewer fix: focused tests only. Exact-head CI authoritative. No routine
WASM/parity/audit/full/legacy suites; audit only on dependency change.

## Context/session policy

Same Pi process/session through implementation + corrections + review. Fresh
Pi process/session at each clean phase boundary (after merge). Prefer a fresh
process over `/new` until the reset path is retested. Never reset mid-phase.

## Fresh-machine checklist (unavoidable ~/.pi steps)

1. Install Pi + Node 24; `pi install` the packages listed above (or copy a
   working `~/.pi/agent` minus sessions/cache/credentials).
2. Apply role `tools:` lines per the matrix (or copy `agents/`).
3. `settings.json`: defaults as above; no Ponytail/analytics/browser packages.
4. `CMD_API_KEY` exported for commandcode routes.
5. Trust project `.pi` (lsp.json hash) on first run.
6. Never commit sessions, caches, FTS DBs, credentials, or `graft/` output.
