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

2. **The runner's output IS the report — post it verbatim.** It is already
   complete markdown (meta table, CI table with log links, a `#### Findings`
   placeholder, and the Verdict). Before posting, replace the Findings
   placeholder with your own factual observations as bullets (contract
   violations, layout/frontmatter/PR-template items) — or delete the section
   if there are none. Do not paraphrase the report into prose; do not reorder
   its sections.

3. Where to post, by verdict (read the Verdict line from the report):
   - **RED** → post the **full report on the PR** (the author needs it) with
     a one-line preamble; on the **card**, post a one-line pointer
     (`🤖 checks RED @ <sha> — report on PR, card stays in Doing`).
   - **GREEN** → post the **full report on the card**, then move the card to
     Review: `scripts/pr_card.sh set-phase <card> review`. No PR comment
     needed (CI results are already visible on the PR).
   - **PENDING** → post a short note on the card only
     (`🤖 checks pending @ <sha> — re-check next tick`). Do not move the card.

4. Receipt discipline: prefix the report title with the head SHA (the runner
   already does: `pr-agent checks @ <sha>`) so the trail is readable.

## Rules

- Never merge from this skill — Review and the `pr-done` guards own that.
- Never re-run failing checks in a loop within one session; one pass per tick.
- Local gate failures are reports, not PR comments (the author sees CI).
- The Findings section is factual only — no style nits, no tone; the review
  skill owns opinions.
