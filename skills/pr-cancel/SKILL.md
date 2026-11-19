---
name: pr-cancel
description: >-
  Cancels a PR card (Cancelled phase): maintainer /cancel or PR closed without
  merge. Posts the reason as a receipt and closes the card. Use on cancel
  findings from the tick or explicit maintainer requests.
license: Apache-2.0
metadata:
  version: "0.1.0"
  maturity: experimental
  owner: eformat
  domain: github-automation
---

# PR cancel (Cancelled phase)

## When to use

- The tick detected a maintainer `/cancel` on the PR or card.
- The tick detected a PR closed without merging.
- Mike asks to abandon a card.

## Procedure

1. Confirm the trigger (one of):
   - `/cancel` comment by a maintainer (`eformat`, `hultzj`) on PR or card;
   - PR state = closed and merged = false;
   - explicit instruction from Mike.
2. Post the receipt:

```bash
scripts/pr_card.sh comment <card-issue> <<EOF
## 🤖 Cancelled

- reason: <maintainer /cancel by @<login> | PR closed unmerged | owner request>
- PR: <url>
- closed at: <UTC timestamp>
EOF
```

3. Transition and close:

```bash
scripts/pr_card.sh set-phase <card-issue> cancelled
scripts/pr_card.sh close <card-issue>
```

## Rules

- `/cancel` by a maintainer wins over everything, including a pending
  READY-TO-MERGE state.
- No deletion, no reopening PRs, no arguments on the PR — the receipt is the
  record.
- If the same PR is later reopened, the tick treats it as a new PR and creates
  a fresh card.
