# POLL.md — pr-agent-poll tick procedure

Run from the `oclaw-pr-agent` repo root. Every step is idempotent; a crashed
tick self-heals on the next one.

## 0. Preflight

```bash
command -v gh jq || exit 1          # binaries
git rev-parse --show-toplevel       # we are at the oclaw-pr-agent repo root
echo "LIVE=${OCLAW_PR_LIVE:-0}"     # default dry-run; live only when the tick sets it
```

If the repo is missing from the workspace, clone it — with the WEB destination
token when running in the OCE sandbox (private or future-private repo), plain
otherwise:

```bash
if [ -n "${GITHUB_TOKEN_WEB:-}" ]; then
  git clone -c credential.helper='!f() { printf "username=x-access-token\npassword=%s\n" "$GITHUB_TOKEN_WEB"; }; f' \
    https://github.com/eformat/oclaw-pr-agent
else
  git clone https://github.com/eformat/oclaw-pr-agent
fi
```

If present, `git pull --ff-only` to pick up skill updates.

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

## 3. Per-PR work session spawn

```text
sessions_spawn {
  label: "pr-<n>",
  task: "You are the PR agent work session for PR #<n> (card #<c>) in
  eformat/redhat-cop-skills. Work from the oclaw-pr-agent repo root.
  Current phase: <phase>. Read and follow skills/<phase-skill>/SKILL.md.
  Receipts go to card #<c> via scripts/pr_card.sh comment. Guardrails from
  skills/pr-agent/SKILL.md apply. Dry-run unless this session was spawned
  by a live tick."
}
```

Notes:
- Spawned child sessions cannot manage automations (`automations`/`agents_list`
  are intrinsically excluded) — that is expected and sufficient.
- Concurrency: before spawning, list running `pr-*` sessions
  (`sessions_list`); if 2 are active, defer the spawn to the next tick.

## 4. Report

End the tick session with a short summary: created / claimed / ready-to-merge /
cancelled counts and any warnings from the tick output.
