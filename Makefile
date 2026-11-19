SHELL := /bin/bash
REPO ?= eformat/redhat-cop-skills
SCRIPTS := scripts/pr_card.sh scripts/pr_labels_bootstrap.sh scripts/pr_tick.sh skills/pr-checks/scripts/run_checks.sh

.PHONY: help lint test labels dry-run
help:
	@echo "oclaw-pr-agent — targets:"
	@echo "  make lint      syntax checks (+ shellcheck when installed)"
	@echo "  make test      lint + dry-run tick against the watched repo (read-only)"
	@echo "  make labels    create phase/* labels (idempotent; add OCLAW_PR_LIVE=1 to apply)"
	@echo "  make dry-run   just the dry-run tick"
	@echo
	@echo "env: OCLAW_PR_REPO=$(REPO)  OCLAW_PR_LIVE=0 (default, dry-run)"

lint:
	@set -e; for f in $(SCRIPTS); do bash -n "$$f" && echo "  ok  bash -n $$f"; done
	@if command -v shellcheck >/dev/null 2>&1; then \
		shellcheck $(SCRIPTS) && echo "  ok  shellcheck"; \
	else \
		echo "  --  shellcheck not installed, skipped"; \
	fi

test: lint
	@OCLAW_PR_REPO=$(REPO) scripts/pr_tick.sh

dry-run:
	@OCLAW_PR_REPO=$(REPO) scripts/pr_tick.sh

labels:
	@OCLAW_PR_REPO=$(REPO) scripts/pr_labels_bootstrap.sh
