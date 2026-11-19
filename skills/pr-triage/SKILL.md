---
name: pr-triage
description: >-
  Creates and triages the phase card for a PR in eformat/redhat-cop-skills
  (Backlog phase). Use when a PR has no card yet or a card was just claimed.
license: Apache-2.0
metadata:
  version: "0.1.0"
  maturity: experimental
  owner: eformat
  domain: github-automation
---

# PR triage (Backlog phase)

## When to use

- A PR has no tracking card (the tick creates an empty card; this skill fills
  the triage receipt).
- A card was just claimed and moved to `phase/doing`.

## Procedure

1. Read the PR: `gh pr view <n> --repo eformat/redhat-cop-skills --json
   title,body,author,files,additions,deletions,changedFiles`.
2. Assess (do not run anything yet):
   - **What**: one-paragraph summary of the change from the diff stat + body.
   - **Type**: new skill / skill change / docs / governance (repo files).
   - **Size/risk**: files touched, +/- lines, whether `skills/<name>/` paths or
     governance paths (`.github/`, `scripts/`, `MAINTAINERS.md`) change — the
     latter need maintainer-tier review per MAINTAINERS.md.
   - **CI preview**: which Skills CI jobs will matter (validate, install-smoke,
     security, lint).
3. Post the triage receipt to the card:

```bash
scripts/pr_card.sh comment <card-issue> <<'EOF'
## 🤖 Triage (Backlog)

**What:** <summary>
**Type:** <new skill | skill change | docs | governance>
**Size:** <n> files, +<a>/-<d>
**Risk:** <low | medium | high> — <one-line why>
**CI preview:** <jobs that matter>
**Next:** claim → Doing (checks)
EOF
```

4. If the tick has already claimed the card (`phase/doing`), hand off to
   `skills/pr-checks/SKILL.md` in the same work session.

## Rules

- Triage is informational — never change code, never comment on the PR itself.
- Draft PRs are skipped by the tick until marked ready.
