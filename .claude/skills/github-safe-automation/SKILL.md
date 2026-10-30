---
name: github-safe-automation
description: Use before Git pushes, GitHub API writes, PR creation, workflow edits, CI reruns or releases. Minimize duplicate GitHub Actions triggers, API bursts and account-safety risks without suppressing required tests. Also use when investigating GitHub warnings, quotas or rate limits.
---

# GitHub Safe Automation — AI operating procedure

Protect engineering quality and responsible GitHub usage. This skill does not guarantee immunity from platform restrictions. Respect GitHub policies and rate limits; never evade enforcement.

## Preflight before any remote write

1. Read root `AGENTS.md`, `CLAUDE.md` and relevant `.github/workflows/` files. Inspect `git status -sb`, branch, remote, recent history and the task diff.
2. Confirm correct account, repository, target branch, PR and write permissions. Do not create redundant PRs or replace existing work.
3. Identify events triggered by the intended push (`push`, `pull_request`, scheduled, manual), duplicate event paths and expensive jobs.
4. If asked only for analysis, remain read-only. Do not commit or push to test whether a GitHub connector works.
5. Do not poll workflow status continuously. Check at meaningful checkpoints, and use the precise head SHA.

## Local-first; bounded GitHub activity

1. Batch related work locally. Run focused tests and relevant full local verification before pushing. Multiple local commits are fine; do not push each tiny edit.
2. Default working budget: **one planned push per validated milestone**; at most **two additional CI-fix push cycles** before pausing to diagnose and report. These are self-imposed defaults, not GitHub limits. User may explicitly approve exceptions.
3. Reuse an existing task branch and Draft PR. Never make empty commits merely to rerun CI, create PRs repeatedly, or set up automatic CI repair loops.
4. Preserve required test coverage: no blanket `[skip ci]`, disabling important jobs, weaker assertions, `|| true`, or `continue-on-error` used just to make a green badge.
5. Verify a CI result belongs to the exact pushed SHA; pushing successfully is not equivalent to passing tests.

## Workflow trigger and cost hygiene

1. Avoid two full workflows for the same change through both feature-branch `push` and `pull_request`. Prefer PR CI for active feature/recovery branches and `push` checks on `main`, subject to required-check review.
2. Keep sensible `concurrency` and `cancel-in-progress: true`. This cancels obsolete runs in a group, but does not stop different events from starting separate runs.
3. Use expensive Windows/native inference, end-to-end database and installer checks where appropriate. Limit unnecessary downloads/artifacts and duplicated work, but do **not** weaken safety-critical verification.
4. Do not create minute-level schedules, self-triggering workflow pushes, recursive rerun jobs, unrestricted matrices or auto deployments without authorization.
5. Changes to workflow triggers/filters require a minimal diff, YAML review, required-check compatibility assessment and predicted run count. Do not automatically modify repository/account security settings.

## Warnings and exceptions

- Distinguish **CI failure notifications**, **free-minutes/billing**, **rate limits**, and **real GitHub security enforcement**. Never assume a failed workflow is an account warning.
- If GitHub returns 403, 429, secondary rate-limit, abuse warning, or suspension: **stop automated writes and retry loops**. Preserve the error and use GitHub's prescribed remedy; do not rotate accounts, proxies, tokens or IPs to bypass restrictions.
- When a check fails, diagnose locally; at most one targeted rerun of a failed job before deeper investigation. Avoid repeated full-workflow retries.
- Do not reset user work, force-push, destroy history, delete evidence, or reveal secrets/research data in logs or artifacts.
- No automatic merge, release, production deployment or account setting change without explicit authorization.

## Completion report

Report the repo, branch, head SHA, PR, **number of remote pushes/PR operations/CI runs this task initiated**, event type, actual CI result, local tests, unresolved risks and unverified native-device tests. The goal is fewer *unnecessary* actions, not less verification.
