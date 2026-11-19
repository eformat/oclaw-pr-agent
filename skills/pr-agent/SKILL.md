---
name: pr-agent
description: >-
  Orchestrates the GitHub PR agent lifecycle for eformat/redhat-cop-skills:
  poll tick, phase routing, per-PR sessions. Use on every pr-agent-poll
  automation tick or when asked to "run the PR agent tick".
license: Apache-2.0
metadata:
  version: "0.1.0"
  maturity: experimental
  owner: eformat
  domain: github-automation
---

# PR agent orchestrator

## When to use

- The `pr-agent-poll` automation fires (every 15 min, isolated session).
- Mike asks to "run the PR agent tick" or "check the PR cards".

## Preconditions

1. The `oclaw-pr-agent` repo is present in the workspace (clone/pull
   `https://github.com/eformat/oclaw-pr-agent` if absent) and is the working
   directory for all commands.
2. `gh` and `jq` are available; `GITHUB_TOKEN` env is set by the sandbox
   (a placeholder the egress proxy substitutes — never print it).
3. Live mode only when `OCLAW_PR_LIVE=1` is set by the automation tick. Without
   it, everything is a dry-run that must perform zero writes.

## Phase routing

| Card label | Owner skill | Next |
|---|---|---|
| `phase/backlog` | (tick claims it) → `pr-triage` | `phase/doing` |
| `phase/doing` | `pr-checks` | `phase/review` (green) / stay (red) |
| `phase/review` | `pr-review` | `phase/done` on guarded merge |
| `phase/review` + `/LGTM` ready | `pr-done` | `phase/done` |
| `/cancel` or PR closed unmerged | `pr-cancel` | `phase/cancelled` |

## Guardrails (non-negotiable)

- Merge requires ALL of: maintainer `/LGTM`, checks green, head SHA unchanged
  since review (`LGTM-SHA:` marker), PR mergeable. Maintainers: `eformat`,
  `hultzj` (override with `OCLAW_PR_MAINTAINERS`).
- One PR claimed per tick; max 2 concurrent per-PR sessions.
- Never force-push; never push to `main`; checkouts are throwaway scratch dirs.
- Every transition posts a receipt comment on the card.

## Tick procedure

Follow `POLL.md` (next to this file) exactly. It is the automation's entry
point and includes the per-PR session spawn template.
