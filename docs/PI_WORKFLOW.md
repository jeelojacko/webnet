# Pi Workflow — Reproducibility Requirements (WebNet)

Tracked companion to the project `.pi/APPEND_SYSTEM.md` (tracked, so a fresh
clone has the routing policy). Machine-local Pi state such as `.pi/lsp.json` is
excluded from version control by the tracked `.gitignore` (`.pi/*` with a
`!.pi/APPEND_SYSTEM.md` exception — not `.git/info/exclude`, which does not
accompany a clone), so it must be recreated by hand or script on a fresh machine
— see the checklist and the paste-loadable template below.

## Default route

Tightly coupled: orchestrator → one `worker` → independent `reviewer` → (correction worker(s) → fresh reviewer)* → exact-head CI.
Parallelizable: orchestrator → parallel `worker`s on genuinely independent substantial scopes → integrate → independent `reviewer` → (correction worker(s) → fresh reviewer)* → exact-head CI.
Smallest useful Worker set; parallelize only when wall-time savings clearly exceed coordination cost.
Scout/Researcher/Oracle are opt-in only (unknown scope / external authority /
genuine dispute). Reviewer is read-only, never delegates, never reruns heavy
suites, reviews the current combined exact state. Fixes go orchestrator → one or more workers → fresh reviewer recheck until APPROVE; only current-state APPROVE ends the loop.

Reviewer returns APPROVE or actionable findings. On findings the orchestrator must not declare complete/PR-ready/merge-ready, must not self-fix substantive findings, and must not treat "review ran" as approval. Route findings through correction worker(s) (parallel only for independent findings), integrate, then fresh reviewer on the new exact state; repeat until APPROVE. Prior APPROVE is stale after any substantive change.

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

- Worker model rotation (all medium reasoning): 1st `commandcode/deepseek/deepseek-v4.1-flash`, 2nd `opencode-go/deepseek-v4.1-flash`, 3rd `opencode-go/muse-spark-1.3-contributor`, then cycle (`commandcode` routes require `$CMD_API_KEY`; `opencode-go` and `commandcode` are distinct provider paths).
- Prefer parallel focused Workers for genuinely independent substantial scopes when wall-clock savings exceed coordination cost; use one Worker for coupled/bounded work (never fan out for discovery, small fan-out, or bounded fixes).
- Retries stay on the original model.
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
5. Recreate `.pi/lsp.json` from the template below (machine-local, ignored by the tracked `.gitignore`), then trust project `.pi` (lsp.json hash) on first run.
6. Never commit sessions, caches, FTS DBs, credentials, `.pi/lsp.json`, or `graft/` output.

## Machine-local `.pi/lsp.json` template

`.pi/lsp.json` is deliberately untracked, so recreate it per machine. Paste the
wrapped config below and replace `<home>` with the local home directory:

```json
{
  "version": 1,
  "servers": [
    {
      "id": "typescript",
      "enabled": true,
      "include": ["**/*.ts", "**/*.tsx"],
      "exclude": [
        "node_modules/**",
        "dist/**",
        "dist-webnet/**",
        "cpp/**",
        "emsdk/**",
        "study-content/**"
      ],
      "rootMarkers": ["package.json", "tsconfig.json"],
      "bin": "<home>/.local/share/mise/shims/typescript-language-server",
      "args": ["--stdio"],
      "cwd": "{root}",
      "languageIdByExtension": {
        ".ts": "typescript",
        ".tsx": "typescriptreact"
      },
      "startupTimeoutMs": 45000,
      "diagnosticsWaitMs": 2500
    }
  ]
}
```

Add a second `clangd` entry inside `servers` for C++ edits, using the same field
shape with `rootMarkers: ["compile_commands.json"]`.
