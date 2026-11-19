# POLL.md — pr-agent-poll tick procedure

Run from the `oclaw-pr-agent` repo root. Every step is idempotent; a crashed
tick self-heals on the next one.

## 0. Preflight

```bash
command -v gh || exit 1             # gh only — scripts use gh's embedded jq (--jq)
git rev-parse --show-toplevel 2>/dev/null || true   # repo root (after clone below)
echo "LIVE=${OCLAW_PR_LIVE:-0}"     # default dry-run; live only when the tick sets it
```

**Never download or install tools/binaries to fill a gap** (no jq tarballs, no
npm/pip installs of unknown packages). The scripts need only `gh`; if a binary
is genuinely missing, STOP and report it in the tick summary.

If the repo is missing from the workspace, clone it — with the WEB destination
token when running in the OCE sandbox (works for private too), plain otherwise:

```bash
if [ -n "${GITHUB_TOKEN_WEB:-}" ]; then
  git clone -c credential.helper='!f() { printf "username=x-access-token\npassword=%s\n" "$GITHUB_TOKEN_WEB"; }; f' \
    https://github.com/eformat/oclaw-pr-agent
else
  git clone https://github.com/eformat/oclaw-pr-agent
fi
```

If present, refresh it (the workspace copy is disposable; GitHub is the source
of truth — a locally patched clone must never block updates):

```bash
git pull --ff-only || git fetch origin && git reset --hard origin/main
```

## 1. Reconcile (mechanical)

```bash
scripts/pr_tick.sh
```

Output sections: Reconcile, Cancel sweep, Claim, Review scan, Summary.
In dry-run the mutations are printed as `[DRYRUN] gh …` lines only.

## 2. Act on findings

Re-run the tick with `OCLAW_PR_LIVE=1` **only** when this tick is a live tick
(automation payload sets it). Then:

- **Cards created** — the tick already created them with `phase/backlog`.
- **Claimed** — the Summary lists claimed PRs (max 1). For each claimed PR,
  spawn its work session (§3). The work session runs `pr-triage` then
  `pr-checks`.
- **READY-TO-MERGE** lines — for each, follow `skills/pr-done/SKILL.md` (spawn
  a work session or, if the merge path is already loaded, execute inline).
- **/cancel findings** — the tick already moved the card to `phase/cancelled`.
- **head moved** findings — the tick already moved the card back to
  `phase/doing`; spawn a work session to re-run checks.

## 3. Do the claimed PR's work INLINE in this session

**Spawned subagent sessions have NO shell/exec tool in OCE** (children lose
exec by design — they coordinate, not execute). Do not delegate the work:
run it in THIS session, which has bash.

After the tick claims a card (Summary: `claimed: PR#N`), continue in this
session — do not end the turn yet:

1. Run `skills/pr-triage/SKILL.md` (triage receipt → card).
2. Run `skills/pr-checks/SKILL.md` (checks report → card; transition per
   verdict).
3. Then end with the tick summary.

Resume semantics (a tick that crashed or ran dry-run mid-cycle leaves a card
mid-phase): the tick also processes actionable cards left behind, oldest
first, inline —
- `phase/doing` card with **no checks report yet** → run `skills/pr-checks/SKILL.md`;
- `phase/doing` card whose last `checks @ <sha>` report predates the current
  head SHA (author pushed new commits) → **re-run `skills/pr-checks/SKILL.md`**
  (fresh report + receipts; CI itself re-ran on GitHub with the push);
- `phase/doing` card whose last verdict was **PENDING** → re-observe
  `gh pr checks`; post a new report only when the verdict changes
  (PENDING → GREEN/RED), then act on it;
- `phase/doing` card whose last verdict was **RED with no new commits** →
  leave it (nothing changed; the author is still working);
- `phase/review` card with **no `LGTM-SHA:` marker** on the card → run
  `skills/pr-review/SKILL.md` (then leave it for maintainer `/LGTM`);
- `phase/review` card with maintainer `/LGTM` (READY-TO-MERGE from the
  reconcile) → run `skills/pr-done/SKILL.md`.

For `READY-TO-MERGE` findings: follow `skills/pr-done/SKILL.md` inline as
well (the merge path is short: guards → merge → receipt).

Spawned sessions are still fine for coordination-only work (they keep
`sessions_*`/`subagents` tools), but never for running the phase skills.

Concurrency: at most 1 card claimed per tick; if a Doing-phase card is
already worked (checks report present), leave it and end the tick.

## 4. Report

End the tick session with a short summary: created / claimed / ready-to-merge /
cancelled counts and any warnings from the tick output.
