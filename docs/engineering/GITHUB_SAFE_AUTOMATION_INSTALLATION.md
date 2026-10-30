# GitHub Safe Automation - local installation and CI audit

Date: 2026-10-30 (Asia/Taipei). Scope: local installation and read-only workflow audit. No commit, push, PR write, CI dispatch/rerun or production change was authorized or performed in this task.

## Installed instructions

| Scope | Location |
| --- | --- |
| Personal Claude Code skill | `~/.claude/skills/github-safe-automation/SKILL.md` |
| Personal Claude Code rules | `~/.claude/CLAUDE.md` |
| Meetfolio Claude Code skill | `.claude/skills/github-safe-automation/SKILL.md` |
| Personal Codex skill | `~/.agents/skills/github-safe-automation/SKILL.md` |
| Personal Codex rules | `~/.codex/AGENTS.md` |
| Meetfolio shared rules | Existing `AGENTS.md`, original bytes preserved with an appended safeguards section |

The personal Claude and Codex rule files did not previously exist; they were created. Existing personal skills/settings were left intact. Project `CLAUDE.md` was unchanged: its existing `@AGENTS.md` import already connects Claude to the shared engineering rules.

The three installed skills are byte-for-byte copies of the reviewed ZIP skill. The ZIP contains only five Markdown files, no executable script or hook. It was extracted into an ignored `work/github-safe-automation-review-*` directory after checking path traversal, symlinks and size limits; its scripts, if any, would not have been executed.

- ZIP SHA-256: `e4793d282cd3478d22e9eaa1f9a0e70ac657ef9756a3b8973614bdc519c9f4bf`.
- Installed SKILL.md SHA-256: `968e907c96b38be27c66d5cf0506af096c4e655005c0d7c24f478f6b0880dccf`.
- Backup and installation manifest: `~/.claude/backups/github-safe-automation-20261030-3b60b6f3/`. This includes the original repository AGENTS.md and before/after hashes. Do not delete existing backups.

The append supplements the existing testing, data safety, native acceptance and no-automatic-merge/release rules. It requires bounded milestone pushes, task-PR reuse, meaningful status checkpoints, preservation of required tests, stopping on rate-limit/enforcement responses, and reporting the exact head/event plus operation counts. A local-only task never gains remote authorization from the skill. Budgets are personal defaults, not official GitHub quotas.

## Recognition and validation

- Codex's bundled `skill-creator/scripts/quick_validate.py`: all three installed copies passed.
- Claude Code **2.1.312**: `plugin validate <personal/project skills parent directory> --strict --json` succeeded for both roots. Passing the individual skill folder initially selected plugin-manifest validation instead; that command shape was corrected.
- Claude's SDK control `initialize` returned `github-safe-automation` in its actual command list, with `(user)` scope. No user/model turn was sent, all tools/MCP were disabled for the probe, and hooks were disabled for that process. An initial zero-budget flag was rejected before initialization because the CLI requires a positive value; the successful metadata-only probe omitted that flag and sent no model request.
- Codex's local app-server `skills/list` returned the skill with `scope: user`, `enabled: true` and no relevant errors, both inside Meetfolio and in a neutral temporary directory outside the repository. No thread/model turn was created.
- Only ignored verification artifacts were written under `work/`. No project application code or workflow was changed, so product tests and GitHub Actions were not run for this installation.

Claude can invoke `/github-safe-automation`; Codex can invoke `$github-safe-automation`. Start a fresh session to load the new global rule files reliably. Same-named Claude skills resolve by priority, rather than being run twice; the personal and project copies are intentionally identical. Instruction files guide behavior but are not branch protection, permission enforcement or a guarantee that an agent/platform will never deviate. No enforcement hook or security setting was added.

Official references: [Claude skills](https://code.claude.com/docs/en/skills), [Claude memory](https://code.claude.com/docs/en/memory), [OpenAI customization](https://learn.chatgpt.com/docs/customization/overview).

## Read-only CI findings

Audited local HEAD `3b454d6c25dc3fc3fc6565c72614b165d92e64b2` on `feat/phase3b-durable-wav`, plus locally available origin refs. No fetch or GitHub repository API call was needed. These refs are local snapshots, not a claim about newly queried server state.

Current HEAD has unrestricted `pull_request` and `push.branches: [main, recovery/complete-source]`, with five jobs: `baseline`, `server`, `desktop-browser`, `web-browser`, `windows-native`. Concurrency uses the PR number for PR events and the branch ref for Push events, so those two events belong to different groups.

If `recovery/complete-source` is the head of an open PR, a push can schedule both Push CI and PR `synchronize` CI. The feature branches do not currently match the Push filter; an existing PR there normally schedules one PR run. The ZIP's claim about paired Actions history was not independently verified; this audit establishes the trigger mechanism, not historical billing or account enforcement.

### Proposed minimal change - NOT applied

Change only the Push branch list to `[main]`. Keep the current PR event and concurrency group:

```yaml
on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: verify-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

Expected counts for one push and at most one open PR whose head is that branch, excluding separate manual/scheduled events:

| Situation | Current configuration | Proposed configuration |
| --- | --- | --- |
| Recovery branch with open PR | 2 workflow runs: Push + PR synchronize | 1 PR run |
| Phase 3A/3B feature branch with open PR | 1 PR run | 1 PR run |
| Feature branch without PR | 0 | 0; run local checks before opening its Draft PR |
| Recovery branch without PR | 1 Push run | 0; this is an explicit coverage tradeoff |
| Main with this workflow installed | 1 Push run | 1 Push run |

Preserve all five current jobs, PostgreSQL repeat/reset checks, both browser suites, the dependency audit, real Windows inference, installer/static review and packaged-runtime checks. Do not add broad path filters, skip-CI markers or weaker assertions. Existing concurrency already cancels obsolete runs within each PR/branch; removing the duplicate trigger is sufficient. Replacing the PR-number key with only the head branch name, as suggested in the ZIP, is unnecessary and can conflate different forks or PR bases sharing a branch name. Multiple legitimate PRs to different bases should retain distinct validation.

Keep `pull_request` unfiltered by base branch: restricting it to `main` would omit the current stacked PRs targeting recovery/feature branches. Review actual required checks/rulesets before applying any future edit; none were changed or remotely inspected in this task. If a merge queue is introduced later, assess its `merge_group` checks separately rather than silently omitting them.

Propagation matters: the local `origin/recovery/complete-source` snapshot has a separate four-job workflow; the Phase 3A/3B snapshots have five. The local `origin/main` snapshot has no ci.yml yet. A change only on Phase 3B will not immediately change the recovery branch's own Push workflow. Any later authorized fix must reach the branch version responsible for the duplicate event, without overwriting newer recovery work or bypassing the existing staged review/merge rules.

The current workflow remains byte-identical: SHA-256 `454c1cd33641d3cb6217e4068d80986cb3b546e8ffe70ef4e9b6fe55cb58a275`. No proposed YAML was installed. [GitHub event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) and [concurrency reference](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency).

Task operation counts: commits **0**, pushes **0**, PR/API writes **0**, CI runs/reruns initiated **0**. Existing Phase 3B test results are not claimed as tests of this new rules-only change.
