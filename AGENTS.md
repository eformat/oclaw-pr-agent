# AGENTS.md — oclaw-pr-agent

Conventions for AI agents (and humans) working in this repository.

## Layout

- `skills/` — agent skills, one dir per skill, `SKILL.md` with redhat-cop-skills
  frontmatter contract (`name` == dir name, `description` ≤500 chars, `license`,
  `metadata.{version, maturity, owner}`). Bodies: `# Title` H1, `## When to use`,
  imperative, harness-neutral.
- `scripts/` — shared bash helpers (gh + jq). Every script: dry-run by default.
- `automation/` — the OCE automation job definition + apply runbook.
- `install/` — Mike-run OCE setup steps.

## Rules

1. **Git**: Mike is git master — make file edits, stop. No state-changing git
   commands (commit/push/checkout/…) by assistants.
2. **Secrets**: no token/PAT values in any file, ever. Scripts read credentials
   from env only (`GITHUB_TOKEN` placeholder substituted by the OCE sandbox
   proxy). Never put secrets in argv. Before finishing edits, grep for
   `AKIA`, `github_pat_`, `gho_`, `ghp_` and remove anything found.
3. **Dry-run default**: mutations require `OCLAW_PR_LIVE=1`. A dry-run must print
   the exact `gh` commands it would run and perform zero writes.
4. **Skills format**: validate by the redhat-cop-skills contract — these skills
   are future contributions to that repo. Keep `description` ≤200 chars target.
5. **State truth**: the phase label on the card IS the state. Never cache phase
   state in files; re-read from GitHub every tick.
6. **One PR claimed per tick** (see `OCLAW_PR_MAX_CLAIM`), max 2 concurrent
   per-PR sessions.
