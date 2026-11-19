# OCE setup — mike agent (Mike-run steps)

Order matters: labels → credentials → agent binding → workspace duty →
automation. Steps 2–4 need the OCE Console / OCC API and a fine-grained PAT.

## 1. Phase labels on the watched repo (live-safe, idempotent)

```bash
OCLAW_PR_LIVE=1 scripts/pr_labels_bootstrap.sh
```

## 2. GitHub PAT

Fine-grained PAT, repository access limited to `eformat/redhat-cop-skills`:

| Permission | Level | Why |
|---|---|---|
| Issues | Read+write | cards are issues |
| Pull requests | Read+write | checks, comments, merge |
| Contents | Read+write | squash merge, scratch clones |
| Actions | Read | `gh pr checks` |

Create it in the GitHub UI; put it in a local file (never argv, never git).

## 3. Secret + two CredentialSources (egress is per-destination)

The PAT lives in a protected file outside git (convention:
`~/.config/oclaw-pr-agent/github-pat`, mode 0600 — it must never appear in
shell commands, URLs, logs, or committed JSON, per the OCE secret-driver doc).

Helper (dry-run first):

```bash
OCE_DRY_RUN=1 OCC_URL=… NAMESPACE_ID=ns_… OCC_SERVICE_KEY_FILE=/secure/occ-service-key.json \
  node scripts/oce_register_credentials.mjs     # prints the requests, token redacted
# then for real (drop OCE_DRY_RUN) — creates:
#   secret "github-pat"                 -> sec_…  (value only in the OCE Secret store)
#   credential source "github-web"      -> cs_…   (bearer-token, host github.com)
#   credential source "github-api"      -> cs_…   (bearer-token, host api.github.com)
```

Both sources share the same Secret ref; they differ in `config.host` and —
critically — **`env_var`**: two sources delivering the same sandbox variable are
refused at revision build with `CREDENTIAL_SOURCE_ENVIRONMENT_CONFLICT`.

- `github-web` → `github.com:443`, **`env_var: GITHUB_TOKEN_WEB`** (git-over-https)
- `github-api` → `api.github.com:443`, **`env_var: GITHUB_TOKEN_API`** (gh REST)

Also **omit `protocol`** from bearer-token configs — setting it selects the
managed-MCP validation branch and is refused ("Use the reviewed settings for a
managed MCP connection").

Scripts select per destination (see `skills/pr-checks/scripts/run_checks.sh`):
`GH_TOKEN="$GITHUB_TOKEN_API"` for `gh`, and a git credential helper with
`GITHUB_TOKEN_WEB` for git.

**Secret** — `POST /namespaces/:id/secrets` with `{ "name": "github-pat", "value": "<from protected file>" }` → returns `sec_…` + `ref`.

**github-web**:

```json
{
  "name": "github-web",
  "type": "bearer-token",
  "config": {
    "env_var": "GITHUB_TOKEN_WEB",
    "host": "github.com",
    "port": "443",
    "path": "/**"
  },
  "secrets": {
    "token": { "kind": "secret", "namespaceId": "ns_…", "id": "sec_…" }
  }
}
```

**github-api**:

```json
{
  "name": "github-api",
  "type": "bearer-token",
  "config": {
    "env_var": "GITHUB_TOKEN_API",
    "host": "api.github.com",
    "port": "443",
    "path": "/**"
  },
  "secrets": {
    "token": { "kind": "secret", "namespaceId": "ns_…", "id": "sec_…" }
  }
}
```

Mechanics (verified 2026-11-19 in the live sandbox): the sandbox agent
processes receive **opaque placeholders** in `GITHUB_TOKEN_WEB` /
`GITHUB_TOKEN_API`; the egress proxy substitutes the real value into the
`Authorization: Bearer` header for traffic to the configured `host:port:path`
only. `gh` (REST → api.github.com) and `git` (https → github.com) sending the
matching placeholder just work; cross-destination use is refused.

**`toolBinaries` caveat:** the executing binaries must be covered
(`/usr/local/sbin/gh` — verified present, v2.103.2 — plus `git`, `curl`,
`node`) or registration is **refused with 409**. If a 409 names a missing
binary, add it to the sandbox policy and retry.

**Sandbox network-policy caveat (hit live 2026-11-19):** the generated
`source-control` rule in the Installation (`github.com:443, tls: skip`) is
rejected by the OpenShell policy engine once a credential source targets
github.com — "rejecting uninspected credentialed endpoint" → `CreateSandbox`
fails with gRPC status 9 and the revision never provisions. The sanctioned fix
(the quickstart's `configure-installation.mjs` does exactly this) is to
**remove that rule**; `networkPolicies` requires `minItems: 1`, so keep one
harmless rule (e.g. `codex-plugin-artifacts`) in its place. Applied on this
installation 2026-11-19: removed from the private `installation.yaml` **and**
from the live `occ-installation-startup` Secret (the chart does not manage that
Secret's content after bootstrap — patch it and roll the API/worker
deployments).

## 4. Bind sources to the agent

Take the two `cs_…` IDs the helper prints and add to the mike agent
Configuration:

```json
"credentialSources": [{ "sourceId": "cs_<github-web-source-id>" }, { "sourceId": "cs_<github-api-source-id>" }]
```

## 5. Workspace duty section (AGENTS.md, ≤16 KiB budget)

Append to the mike agent's workspace `AGENTS.md` (Control UI workspace tab or
`PUT /namespaces/:ns/agents/:agentId/workspace/files/AGENTS.md`):

```markdown
# PR agent duty (oclaw-pr-agent)

You operate the GitHub PR agent for eformat/redhat-cop-skills.

- On every pr-agent-poll automation tick: clone/pull
  https://github.com/eformat/oclaw-pr-agent into the workspace, then follow
  its skills/pr-agent/POLL.md exactly (dry-run unless the tick is live).
- GitHub credentials arrive as SEPARATE per-destination placeholders:
  GITHUB_TOKEN_API (gh REST, api.github.com) and GITHUB_TOKEN_WEB (git
  https, github.com). The egress proxy substitutes them into the
  Authorization header — never print them, never put them in argv or files.
  - Before ANY gh command: export GH_TOKEN="${GITHUB_TOKEN_API:-$GH_TOKEN}"
  - For git-over-https: use a credential helper with GITHUB_TOKEN_WEB
    (see skills/pr-checks/scripts/run_checks.sh). Plain curl to
    api.github.com is refused (curl is not a toolBinary); use gh.
  - NEVER download or install tools/binaries (jq, npm/pip packages from
    unknown repos). The pr-agent scripts need only gh. If something is
    missing, STOP and report it in the tick summary.
- Phase state = phase/* labels on card issues; exactly one at a time. The
  label swap IS the transition. Receipts as card comments.
- NEVER merge without all five guards: PR is in the watched repo
  (eformat/redhat-cop-skills) + maintainer /LGTM + green checks +
  head SHA unchanged since review + mergeable. Maintainers: eformat, hultzj.
- /cancel by a maintainer cancels the card immediately.
- One PR claimed per tick; max 2 concurrent per-PR sessions.
```

## 6. Create the automation

Follow `automation/apply-runbook.md` path 1 (chat — verified) or 2 (UI form).

## 7. First live cycle (dogfood)

1. `gh api repos/eformat/redhat-cop-skills --jq .default_branch` from the
   agent (or Mike's laptop) — egress smoke.
2. Open a throwaway PR on the fork (or wait for a real one).
3. Watch one full cycle: Backlog → Doing → Review → `/LGTM` → merged → Done,
   with receipts on the card.
4. Then leave the automation running.
