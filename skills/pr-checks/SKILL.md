---
name: pr-checks
description: >-
  Runs checks on a PR (Doing phase): CI status via gh pr checks and an optional
  local make lint, then posts a markdown report to the phase card. Use when a
  card enters or sits in phase/doing.
license: Apache-2.0
metadata:
  version: "0.1.0"
  maturity: experimental
  owner: eformat
  domain: github-automation
---

# PR checks (Doing phase)

## When to use

- A card enters `phase/doing` (fresh claim, or head moved after `/LGTM`).
- Re-checking a PR whose CI was pending on the last pass.

## Procedure

1. Run the checks runner from the `oclaw-pr-agent` repo root:

```bash
skills/pr-checks/scripts/run_checks.sh <pr-number> > /tmp/checks-report.md
```

Set `OCLAW_PR_LOCAL_LINT=1` to also run the repo's local `make lint` gate
(needs python3 + pytest + ruff in the sandbox; the runner skips gracefully and
says so when the toolchain is missing).

2. Read the report verdict:
   - **GREEN** — post the report to the card, then move the card to Review:
     `scripts/pr_card.sh set-phase <card> review`.
   - **RED** — post the report to the card with a "changes requested" preamble.
     The card **stays** in `phase/doing` (the author fixes; the next tick
     re-runs checks). Optionally leave a review comment on the PR asking for
     fixes — facts only, no style nits.
   - **PENDING** — post a short "checks pending, will re-check next tick"
     note. Do not move the card.

3. Receipt discipline: one report comment per check run is fine for v1; prefix
   each with the head SHA so the trail is readable:

```text
### 🤖 Checks @ <short-sha>
<report>
```

## Rules

- Never merge from this skill — Review and the `pr-done` guards own that.
- Never re-run failing checks in a loop within one session; one pass per tick.
- Local gate failures are reports, not PR comments (the author sees CI).
