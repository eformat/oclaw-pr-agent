# oclaw-pr-agent

A GitHub PR agent that runs as an **OpenClaw Enterprise (OCE) automation** on Mike's
agent. For every PR in `eformat/redhat-cop-skills` it starts a **fresh session per
PR** and walks it through a five-phase lifecycle, tracked by **card issues +
phase labels** in the watched repo. The agent squash-merges on maintainer `/LGTM`.

```
GitHub (PRs + card issues + phase labels)
   ▲  gh CLI (PAT via OCE bearer-token CredentialSources, placeholder env)
   │
OCE agent "mike" (main)
 ├─ automation "pr-agent-poll" ── every 15 min ──▶ ISOLATED tick session
 │    payload.agentTurn.message → skills/pr-agent/POLL.md
 │    1. reconcile PRs ↔ cards (create missing cards, phase/backlog)
 │    2. claim oldest backlog card → phase/doing → sessions_spawn per-PR session
 │    3. cancel-sweep closed PRs; scan Review cards for maintainer /LGTM
 └─ per-PR work sessions (sessions_spawn children) ── run phase skills + scripts
```

## Phase model

| Phase | Label | Meaning | Exit |
|---|---|---|---|
| Backlog | `phase/backlog` | PR card available for work | agent claims → Doing |
| Doing | `phase/doing` | Agent runs checks on PR | green → Review; red → stay, request changes |
| Review | `phase/review` | Needs maintainer `/LGTM` | `/LGTM` → merge → Done |
| Done | `phase/done` | Squash-merged, receipt posted | terminal |
| Cancelled | `phase/cancelled` | PR closed unmerged, or `/cancel` | terminal |

The **label swap is the state transition**. One `phase/*` label on a card at all
times. Every agent action posts a receipt comment on the card (audit trail).

**Merge guard (all four required):** maintainer `/LGTM` (`eformat`, `hultzj`) +
checks green + head SHA unchanged since review (`LGTM-SHA:` marker on the card) +
PR mergeable. `/cancel` by a maintainer cancels immediately.

## Layout

```
skills/            # the agent's skills (redhat-cop-skills frontmatter format)
  pr-agent/        # orchestrator: SKILL.md + POLL.md (the automation tick procedure)
  pr-triage/       # Backlog: card creation + triage summary
  pr-checks/       # Doing: run_checks.sh + CI watching, report to card
  pr-review/       # Review: contract review, /LGTM protocol, SHA guard
  pr-done/         # merge path: guards → squash merge → receipt
  pr-cancel/       # Cancelled path
scripts/           # shared deterministic helpers (bash + gh + jq)
  pr_card.sh               # card find/create/set-phase/comment/close/show
  pr_labels_bootstrap.sh   # one-time: create phase/* labels on the watched repo
  pr_tick.sh               # the reconcile tick (dry-run by default)
automation/        # pr-agent-poll job definition + apply runbook
install/           # Mike-run OCE setup steps (credentials, workspace, labels)
```

## Quickstart (local, read-only)

```bash
make test          # syntax checks + dry-run tick against the watched repo
make labels        # one-time, live-safe: create phase/* labels (Mike-run)
```

**Dry-run is the default.** Scripts only mutate GitHub when `OCLAW_PR_LIVE=1`.
Every dry-run prints the exact `gh` invocations it *would* make.

## Golden cases (M1 matrix)

| Scenario | Expected |
|---|---|
| New PR opened | card created with `phase/backlog`, triage comment |
| Checks red | stays `phase/doing`, changes-requested comment |
| Checks green | → `phase/review`, review posted, `LGTM-SHA:` recorded |
| `/LGTM` missing | stays `phase/review` |
| `/LGTM` + green + SHA match + mergeable | squash merge → receipt → `phase/done` → card closed |
| Head SHA moved after `/LGTM` | back to `phase/doing` (re-checks), regression comment |
| PR closed unmerged | → `phase/cancelled`, card closed |
| Maintainer `/cancel` | → `phase/cancelled` regardless of phase |
| PR merged while card open | → `phase/done` with "merged externally" receipt |

## OCE mechanics this stands on (verified 2026-11-19)

- Automations are **Gateway-local cron jobs** (`sessionTarget: "isolated"` → new
  session per run; `payload.kind: "agentTurn"`; command payloads and event
  triggers are blocked in OCE). Not OCC resources — `automation/pr-agent-poll.json`
  is the documentation-of-record for recreating after gateway state loss.
- `sessions_spawn` is allowed in OCE's baseline gateway tool policy; spawned
  children lose `automations`/`agents_list` (fine — PR sessions need gh/git only).
- No webhook receiver in OCE → polling automation is the trigger. (Upgrade path:
  `GatewayClient` → `wss://…/namespaces/<ns>/agents/<agent>` → `chat.send` with a
  fresh `sessionKey` per delivery.)
- Workspace files are the 4 fixed files ≤16 KiB → **this repo is the skill
  distribution**: the tick clones/pulls it into the agent workspace at runtime.
- GitHub PAT rides `bearer-token` CredentialSources — **two** (`github.com`,
  `api.github.com`), env holds a proxy-substituted placeholder, `toolBinaries`
  must cover `gh`/`git`/`curl`/`node` or registration 409s.

Design receipts (OCE automation internals, verified 2026-11-19) are documented
in `automation/apply-runbook.md` and `install/agent-setup.md`.

## License

Apache-2.0 — see [LICENSE](LICENSE). The skills follow the same contract as
`redhat-cop/skills` (root LICENSE covers every skill).
