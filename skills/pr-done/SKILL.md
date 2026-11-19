---
name: pr-done
description: >-
  Executes the guarded merge path for a Review-phase PR: re-verifies all four
  guards, squash-merges on maintainer /LGTM, posts the receipt, closes the
  card as Done. Use only on READY-TO-MERGE findings.
license: Apache-2.0
metadata:
  version: "0.1.0"
  maturity: experimental
  owner: eformat
  domain: github-automation
---

# PR done (merge path)

## When to use

- The tick printed `READY-TO-MERGE` for a Review card.
- Never speculatively: this skill is only entered after `/LGTM` was detected.

## The five guards (re-verify ALL, right now — do not trust the tick's cache)

```bash
# 0. REPO IDENTITY — the PR lives in the watched repo, nowhere else
url="$(gh pr view <n> --repo eformat/redhat-cop-skills --json url --jq .url)"
case "$url" in
  https://github.com/eformat/redhat-cop-skills/pull/*) : ;;   # ok
  *) die-or-abort ;;                                          # wrong repo → never merge
esac
# 1. maintainer /LGTM present (scan PR comments + reviews + card comments)
#    author login ∈ OCLAW_PR_MAINTAINERS (default eformat,hultzj)
# 2. checks green RIGHT NOW
gh pr checks <n> --repo eformat/redhat-cop-skills
# 3. head SHA unchanged since the review that recorded LGTM-SHA:
current="$(gh pr view <n> --repo eformat/redhat-cop-skills --json headRefOid --jq .headRefOid)"
recorded="<LGTM-SHA from the card>"          # grep the card comments
[ "$current" = "$recorded" ]                 # mismatch → abort, back to Doing
# 4. mergeable
gh pr view <n> --repo eformat/redhat-cop-skills --json mergeable --jq .mergeable
#    must be MERGEABLE (CONFLICTING/UNKNOWN → abort with a card note)
```

**If any guard fails:** do not merge. Comment the failure on the card and move
the card accordingly (`phase/doing` for head-moved/pending checks; stay in
`phase/review` for missing LGTM).

## Merge (all four guards green, live mode)

```bash
gh pr merge <n> --repo eformat/redhat-cop-skills --squash
```

- The agent merges ONLY in live mode (`OCLAW_PR_LIVE=1`), ONLY after the guards.
- No force-push, no direct pushes to `main`, no merge-commit strategy.

## Receipt + Done

```bash
sha="$(gh pr view <n> --repo eformat/redhat-cop-skills --json mergeCommit --jq .mergeCommit.oid)"
scripts/pr_card.sh comment <card-issue> <<EOF
## 🤖 Merged (Done)

- squash-merged by the pr-agent on maintainer /LGTM (@<login>)
- merge commit: <sha>
- guards at merge time: /LGTM ✅ checks ✅ SHA ✅ mergeable ✅

Thanks @<author>!
EOF
scripts/pr_card.sh set-phase <card-issue> done
scripts/pr_card.sh close <card-issue>
```

If the PR was already merged externally, post the "merged externally" receipt
instead and close the card as `phase/done` (the tick also handles this case).
