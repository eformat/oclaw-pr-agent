#!/usr/bin/env bash
# run_checks.sh — PR checks runner (Doing phase). Emits a markdown report.
#
# Read-only except the throwaway scratch checkout. Never comments, never
# merges, never transitions cards — the caller (pr-checks skill) owns those.
#
# Env:
#   OCLAW_PR_REPO         watched repo (default eformat/redhat-cop-skills)
#   OCLAW_PR_LOCAL_LINT   1 = also run the repo's local `make lint` in the
#                         scratch checkout (needs python3/pytest/ruff; skipped
#                         gracefully when absent)
#   OCLAW_PR_WORKDIR      scratch root (default ${TMPDIR:-/tmp}/oclaw-pr-agent)
set -euo pipefail

REPO="${OCLAW_PR_REPO:-eformat/redhat-cop-skills}"
LOCAL_LINT="${OCLAW_PR_LOCAL_LINT:-0}"
WORKDIR="${OCLAW_PR_WORKDIR:-${TMPDIR:-/tmp}/oclaw-pr-agent}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
for bin in gh jq git; do command -v "$bin" >/dev/null 2>&1 || die "$bin is required"; done

pr="${1:?usage: run_checks.sh <pr-number>}"
pr="$(printf '%s' "$pr" | grep -oE '[0-9]+$')"

meta="$(gh pr view "$pr" --repo "$REPO" \
  --json title,url,author,headRefName,headRefOid,baseRefName,additions,deletions,changedFiles,isDraft)"

title="$(printf '%s' "$meta" | jq -r .title)"
head_oid="$(printf '%s' "$meta" | jq -r .headRefOid)"
short_oid="${head_oid:0:12}"

printf '### 🤖 Checks @ `%s`\n\n' "$short_oid"
printf '| field | value |\n|---|---|\n'
while IFS=$'\t' read -r k v; do printf '| %s | %s |\n' "$k" "$v"; done < <(
  printf '%s' "$meta" | jq -r '[
    ["PR", "#'"$pr"'"],
    ["Title", .title],
    ["Author", "@" + .author.login],
    ["Branch", "`" + .headRefName + "` → `" + .baseRefName + "`"],
    ["Diff", (.changedFiles | tostring) + " files, +" + (.additions | tostring) + "/-" + (.deletions | tostring)],
    ["Draft", (.isDraft | tostring)]
  ] | .[] | @tsv')

# ---------- CI checks (remote, always) ----------
printf '\n#### CI (Skills CI)\n\n'
checks_out="$(mktemp)"
checks_rc=0
gh pr checks "$pr" --repo "$REPO" > "$checks_out" 2>&1 || checks_rc=$?
# gh exit codes: 0 = all passed, 1 = failure, 8 = pending
if grep -q "no checks reported" "$checks_out"; then
  ci_verdict="PENDING"
  printf '_no CI checks reported yet (workflows may not have started)_\n'
elif [ "$checks_rc" = "8" ]; then ci_verdict="PENDING"; elif [ "$checks_rc" = "0" ]; then ci_verdict="GREEN"; else ci_verdict="RED"; fi
if [ -s "$checks_out" ] && ! grep -q "no checks reported" "$checks_out"; then
  printf '```\n%s\n```\n' "$(cat "$checks_out")"
fi
rm -f "$checks_out"

# ---------- local gate (optional) ----------
local_verdict="skipped (set OCLAW_PR_LOCAL_LINT=1)"
if [ "$LOCAL_LINT" = "1" ]; then
  scratch="$WORKDIR/pr-$pr"
  if [ -d "$scratch/.git" ]; then
    git -C "$scratch" fetch --force origin "pull/$pr/head" >/dev/null 2>&1
  else
    mkdir -p "$(dirname "$scratch")"
    gh repo clone "$REPO" "$scratch" -- --depth 50 >/dev/null 2>&1
    git -C "$scratch" fetch origin "pull/$pr/head" >/dev/null 2>&1
  fi
  git -C "$scratch" checkout --force --detach FETCH_HEAD >/dev/null 2>&1
  lint_log="$(mktemp)"
  if command -v make >/dev/null 2>&1 && [ -f "$scratch/Makefile" ]; then
    if ( cd "$scratch" && timeout 900 make lint ) > "$lint_log" 2>&1; then
      local_verdict="GREEN"
    else
      local_verdict="RED"
    fi
  else
    local_verdict="skipped (make/Makefile unavailable)"
  fi
  printf '\n#### Local gate (make lint @ %s)\n\n' "$short_oid"
  printf 'verdict: %s\n\n' "$local_verdict"
  printf '```\n%s\n```\n' "$(tail -40 "$lint_log")"
  rm -f "$lint_log"
fi

# ---------- verdict ----------
printf '\n#### Verdict\n\n'
if [ "$ci_verdict" = "GREEN" ] && { [ "$local_verdict" = "GREEN" ] || [[ "$local_verdict" == skipped* ]]; }; then
  printf '**GREEN** — ready for Review (maintainer `/LGTM` required to merge).\n'
elif [ "$ci_verdict" = "PENDING" ]; then
  printf '**PENDING** — CI still running; re-check next tick.\n'
else
  printf '**RED** (ci=%s local=%s) — changes requested; card stays in Doing.\n' \
    "$ci_verdict" "$local_verdict"
fi
