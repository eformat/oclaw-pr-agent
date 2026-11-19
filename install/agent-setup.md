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

## 3. CredentialSources (two — egress is per-destination)

Register via `POST /namespaces/:id/credential-sources` (or the OCE Console).
Both use the same PAT; `env_var` is what the sandbox sees.

**github-web** (git clone / push over https):

```json
{
  "name": "github-web",
  "type": "bearer-token",
  "config": {
    "env_var": "GITHUB_TOKEN",
    "host": "github.com",
    "port": "443",
    "path": "/**",
    "protocol": "https"
  },
  "secrets": { "token": "<SecretReference — shape per docs/reference/credential-sources.md>" }
}
```

**github-api** (REST: pr checks, merges, reviews):

```json
{
  "name": "github-api",
  "type": "bearer-token",
  "config": {
    "env_var": "GITHUB_TOKEN",
    "host": "api.github.com",
    "port": "443",
    "path": "/**",
    "protocol": "https"
  },
  "secrets": { "token": "<same SecretReference as above>" }
}
```

Mechanics (verified against openclaw-enterprise docs): the sandbox receives an
**opaque placeholder** in `GITHUB_TOKEN`; the egress proxy substitutes the real
value into the `Authorization: Bearer` header for traffic to the configured
`host:port:path` only. `gh`/`git`/`curl` sending the placeholder header just
work. Default-deny otherwise.

**`toolBinaries` caveat:** the executing binaries must be covered
(`/usr/local/sbin/gh` — verified present, v2.103.2 — plus `git`, `curl`,
`node`) or registration is **refused with 409**. If a 409 names a missing
binary, add it to the sandbox policy and retry.

## 4. Bind sources to the agent

OCE Console → mike agent Configuration → add:

```json
"credentialSources": [{ "sourceId": "cs_<github-web-source-id>" }, { "sourceId": "cs_<github-api-source-id>" }]
```

Then **Deploy new version** (Configuration changes ride the version lifecycle).

## 5. Workspace duty section (AGENTS.md, ≤16 KiB budget)

Append to the mike agent's workspace `AGENTS.md` (Control UI workspace tab or
`PUT /namespaces/:ns/agents/:agentId/workspace/files/AGENTS.md`):

```markdown
# PR agent duty (oclaw-pr-agent)

You operate the GitHub PR agent for eformat/redhat-cop-skills.

- On every pr-agent-poll automation tick: clone/pull
  https://github.com/eformat/oclaw-pr-agent into the workspace, then follow
  its skills/pr-agent/POLL.md exactly (dry-run unless the tick is live).
- Phase state = phase/* labels on card issues; exactly one at a time. The
  label swap IS the transition. Receipts as card comments.
- NEVER merge without all four guards: maintainer /LGTM + green checks +
  head SHA unchanged since review + mergeable. Maintainers: eformat, hultzj.
- /cancel by a maintainer cancels the card immediately.
- GitHub token arrives as env (GITHUB_TOKEN placeholder, substituted by the
  egress proxy). Never print it, never put it in argv or files.
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
