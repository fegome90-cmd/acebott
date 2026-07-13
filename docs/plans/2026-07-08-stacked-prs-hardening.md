# 2 Stacked PRs for Harness Hardening — Historical Plan Record (v3, audit-hardened)

> **Historical snapshot (2026-07-08):** This plan records the pre-merge
> execution state based on `c22cfbc`. It is not an executable plan. Since then,
> `origin/main` advanced and the merged harness reports 233 tests. Treat every
> command block below as historical evidence only; do not rerun branch,
> cherry-pick, push, PR, or merge commands without revalidating the commit
> SHAs, base, and test expectations. Use `apply-progress.md` for the current
> hardening status.

**Historical goal:** Split the harness hardening work into 2 stacked PRs (code, then docs) that each compile and pass the full suite. Incorporates all findings from two external audits and the local preflight.

**Test baselines (three distinct numbers — do not confuse):**
- **164 tests** = baseline at `c22cfbc` (origin/main, before any hardening).
- **224 tests** = after the initial hardening apply, before the 6 post-review fixes.
- **232 tests** = historical pre-merge snapshot captured by this plan after the 6 post-review fixes. The current merged final is **233 tests**; use `apply-progress.md` as the current source of truth.

**Architecture:** Two stacked PRs. PR1 = all harness code + tests (7 commits, ~3700 lines, builds clean per preflight). PR2 = documentation + OpenSpec artifacts (3 commits, ~2500 lines, no build impact). PR2 bases on PR1; both merge into `main` sequentially with explicit retargeting.

**Tech Stack:** Git, GitHub CLI (`gh`), `fegome90-cmd/acebott`.

**Base commit:** `c22cfbc` (= `origin/main`, last pushed).

**Why only 2 PRs (not 6):** A local preflight proved that the 6-PR modular split breaks the TypeScript build on PRs 2-4. Root cause: `src/index.ts` and `tests/integration/hardware.test.ts` on the base commit already reference APIs (`SerialReadResult`, `HealthCheckResult`, `RunHealthCheckOptions`, `mapSerialResult`) introduced by later commits. Splitting by module creates intermediate states where consumers exist without their providers. The only clean splits are "all code" (compiles) and "all docs" (no build impact).

**Preflight validated:** PR1 (all 7 code commits cherry-picked in order) → build exit 0, lint exit 0, 232/232 tests pass. PR2 (3 docs commits) → build exit 0, lint exit 0, 232/232 tests pass.

---

## Audit findings incorporated

This plan addresses all 8 findings from the external audit:

1. **Merge flow corrected** — explicit `gh pr edit --base main` retargeting after each merge (Tasks 3 and 5).
2. **Full suite per PR** — preflight verified both PRs pass `build && lint && test` completely.
3. **Cherry-pick order proven** — preflight applied all cherry-picks cleanly; no conflicts.
4. **No dangling spec references** — PR bodies cite commit SHAs and requirements inline, not file paths that don't exist yet. OpenSpec artifacts land in PR2 (after code).
5. **Correct `gh pr list` commands** — use `--jq` with `startswith()`, not `--head` with glob.
6. **PR2 scope reduced** — only `harden-harness-and-docs` artifacts; `fix-robot-probe-and-flash-safety` excluded.
7. **Out-of-scope contamination check** — explicit verification step (Task 6).
8. **Branch auto-delete warning** — documented in merge instructions.

## Commit inventory (what we have, chronological)

```
157b8d8  fix(child-process)     ← PR1
d154825  fix(serial)            ← PR1
05b3f2b  fix(health)            ← PR1
68bd747  test(health)           ← PR1
4fbb94a  fix(esptool)           ← PR1
292692c  test(render-health)    ← PR1
4235c4c  docs(apply-progress)   ← PR2
68c69e8  fix(qd001 M3/M4)       ← EXCLUDE (out of scope)
7844f78  feat(arduino-cli)      ← PR1
2613dc7  docs(qd001 skills)     ← EXCLUDE (out of scope)
cb465e3  docs(openspec)         ← PR2
34e9670  docs(AGENTS)           ← PR2
```

**Note on ordering:** `7844f78` (arduino-cli, PR1) chronologically sits AFTER `4235c4c` (docs, PR2). Cherry-pick handles this — we pick commits individually, not by range.

## PR breakdown

| PR | Module | Commits (cherry-pick order) | Lines |
|----|--------|------------------------------|-------|
| 1 | harness code + tests | `157b8d8` `d154825` `05b3f2b` `68bd747` `4fbb94a` `292692c` `7844f78` | ~3700 |
| 2 | docs + OpenSpec + AGENTS + skill | `4235c4c` `cb465e3` `34e9670` | ~2500 |

**Excluded (out of scope, different changes):** `68c69e8` (M3/M4 motors), `2613dc7` (QD001 skills).

**Excluded from PR2 scope:** `openspec/changes/fix-robot-probe-and-flash-safety/` (different change, introduced by `cb465e3` alongside harden-harness artifacts — must be filtered out during cherry-pick or reverted after).

---

## Pre-flight: verify environment

**Step 1: Verify gh CLI authenticated**

Historical command evidence: `gh auth status`
Expected: "Logged in to github.com" with access to `fegome90-cmd/acebott`.

**Step 2: Verify origin remote**

Historical command evidence: `git remote get-url origin`
Expected: `https://github.com/fegome90-cmd/acebott.git`

**Step 3: Verify origin/main matches base**

Historical command evidence: `git rev-parse origin/main`
Expected: `c22cfbc...`

**Step 4: Verify working tree is clean**

Historical command evidence: `git status --porcelain`
Expected: empty output. If not empty, stash or commit before proceeding.

If any step fails, STOP and resolve.

---

## Task 1: Create branch `harden/1-code` for PR1 (all harness code)

**Step 1: Create branch from origin/main**

```bash
cd "$(git rev-parse --show-toplevel)"
git checkout -b harden/1-code c22cfbc
```

**Step 2: Cherry-pick the 7 code commits in chronological order**

```bash
git cherry-pick 157b8d8
git cherry-pick d154825
git cherry-pick 05b3f2b
git cherry-pick 68bd747
git cherry-pick 4fbb94a
git cherry-pick 292692c
git cherry-pick 7844f78
```

Expected: all 7 apply cleanly (preflight verified this). If any conflict, STOP — do not resolve creatively; report the conflict.

**Step 3: Run full harness suite (all three gates)**

```bash
cd "$(git rev-parse --show-toplevel)/harness"
pnpm run build
echo "BUILD_EXIT=$?"
pnpm run lint
echo "LINT_EXIT=$?"
pnpm test
echo "TEST_EXIT=$?"
```

Expected: BUILD_EXIT=0, LINT_EXIT=0, TEST_EXIT=0, 232 tests pass across 11 files.

If any gate fails, STOP and report. Do NOT open the PR with a broken build.

**Step 4: Verify no out-of-scope files touched**

```bash
cd "$(git rev-parse --show-toplevel)"
git diff --name-only c22cfbc..harden/1-code
```

Expected output (only these paths):
```
harness/src/index.ts
harness/src/lib/arduino-cli.ts
harness/src/lib/child-process.ts
harness/src/lib/esptool.ts
harness/src/lib/serial.ts
harness/src/tools/health.ts
harness/tests/integration/hardware.test.ts
harness/tests/unit/arduino-cli.test.ts
harness/tests/unit/child-process.test.ts
harness/tests/unit/esptool.test.ts
harness/tests/unit/health.test.ts
harness/tests/unit/render-health.test.ts
harness/tests/unit/serial.test.ts
```

If ANY other path appears (especially `skills/qd001-*`, `AGENTS.md`, `openspec/`), STOP — contamination occurred.

**Step 5: Return to harness dir and commit nothing**

No additional commit needed — cherry-picks are the commits.

---

## Task 2: Push PR1 and open the PR

**Step 1: Push branch**

```bash
cd "$(git rev-parse --show-toplevel)"
git push -u origin harden/1-code
```

**Step 2: Open PR**

```bash
gh pr create \
  --base main \
  --head harden/1-code \
  --title "feat(harness): harden child-process, compile, flash, serial, and health lifecycle" \
  --body "## Summary

Hardens the ACEBOTT harness with race-safe child-process primitives, settle-once wrappers, discriminated result types, full health-check error boundary, and flash artifact validation. Addresses audit findings 3-6 and 8 from the static audit.

## What (7 commits — review commit-by-commit)

### \`fix(child-process): guard terminateChild\` (157b8d8)
- NEW \`child-process.ts\`: \`terminateChild\` (never throws), \`waitForClose\` (race-safe), \`ChildTerminationError\`, \`TerminateChildResult\`, \`safeLog\`
- Null-guard returns \`already_closed\` for \`undefined\` proc (foundation for readSerial early-abort)
- 24 tests

### \`fix(serial): guard finalize early abort\` (d154825)
- \`SerialReadResult\` discriminated union (success | incomplete | timeout | error | cancelled)
- Two-phase settlement: \`selectResult\` (settle-once) → \`finalize\` (await terminateChild)
- Early-abort guard: if no process spawned, resolve without calling terminateChild
- **Breaking (internal):** \`readSerial\` returns \`Promise<SerialReadResult>\` not \`Promise<string[]>\`
- 20 tests

### \`fix(health): log pkill failures\` (05b3f2b)
- Full \`runHealthCheck\` rewrite: try/catch/finally boundary, \`cleanupAllowed\` flag
- \`ChildTerminationError\` priority over cancellation (checked before isAbortError)
- \`mapSerialResult\` exhaustive mapping with assertNever
- \`pkill ACECode\` failures logged via safeLog (not swallowed)
- **Breaking (internal):** \`runHealthCheck\` takes \`RunHealthCheckOptions\` object

### \`test(health): deepen 9.13\` (68bd747)
- 40 tests: detection failure, abort checkpoints, mkdtemp failure, skipFlash, cancellation priority, cleanup isolation, stage transitions, result mappings, neutral semantics
- Test 9.13 asserts code + processMayStillBeRunning + stage (not just status)

### \`fix(esptool): preserve stat error code\` (4fbb94a)
- \`validateFlashArtifacts\`: bootloader, partition table, boot_app0, firmware validated BEFORE spawn
- Preserves errno (ENOENT/EACCES/EIO) in message — does not collapse to 'not found'
- \`settleFlashWrapper\`: esptool variant of settle-once controller
- 24 tests

### \`test(health): cover renderHealthResult\` (292692c)
- Exports \`renderHealthResult\`, adds 5 tests verifying rendered text never says 'healthy'/'passed'
- Locks REQ-011 (neutral health semantics)

### \`feat(harness): harden arduino-cli lifecycle\` (7844f78)
- \`settleWrapper<T>\`: shared settle-once controller for compile
- Abort listener removed on every terminal path; no unhandled rejections
- Updates index.ts exports, hardware.test.ts integration signature
- 15 tests

## Test count

Baseline 164 → final 232 (+68 tests across 1 new file).

## Critical safety invariants

- \`terminateChild\` NEVER throws — always returns \`TerminateChildResult\`
- \`ChildTerminationError\` has PRIORITY over cancellation
- Failed termination → error + \`child_termination_unconfirmed\` + preserved build dir + skipped cleanup
- \`protocol_complete\` rendered as 'Protocol complete' — never 'healthy'/'passed'
- esptool never spawns when artifacts missing/empty/not-regular-file

## Size note

~3700 lines across 7 commits. **Review commit-by-commit** — each is independently coherent. This is a large PR because a modular split was attempted and rejected: the TypeScript build breaks on intermediate states (see preflight results). Keeping all code together ensures every commit compiles.

## Stacked PR note

PR 1 of 2. PR 2 (docs) builds on this branch. Merge this first."
```

**Step 3: Verify PR opened**

```bash
gh pr view --json url,state,number
```
Expected: state OPEN, URL and number printed. Record the PR number.

---

## Task 3: Wait for PR1 merge (manual step — reviewer)

This is a **manual checkpoint**. The plan pauses here.

**Historical reviewer instructions:**
1. Review PR1 commit-by-commit.
2. Run the full suite locally if CI is not configured: \`cd harness && pnpm run build && pnpm run lint && pnpm test\`.
3. Merge PR1 into \`main\`. Both merge styles work, but they affect Task 5 differently:
   - **Regular merge commit** (recommended): \`harden/1-code\` remains ancestral to \`main\`. PR2 retargets cleanly.
   - **Squash merge**: PR2 must be rebased onto the new main (see Task 5 Step 1b for the exact rebase command). Do NOT delete the \`harden/1-code\` branch until PR2 is rebased.
4. **Do NOT delete the \`harden/1-code\` branch** if GitHub offers — PR2 still bases on it. If auto-delete is on, disable it for this repo/branch or re-create the branch from main: \`git push origin main:harden/1-code\`.

**After PR1 is merged, verify main advanced:**

```bash
cd "$(git rev-parse --show-toplevel)"
git checkout main
git pull origin main
git log --oneline -3
```

Expected: main HEAD advanced. If regular merge, the 7 code commits are in main's history. If squash, main has one squashed commit whose diff matches the 7 commits' combined diff — verify with \`git diff --name-only c22cfbc..origin/main\` (should show the 13 harness files only).

---

## Task 4: Create branch `harden/2-docs` for PR2

**Base:** PR2 builds on PR1's branch (not on main directly), so it carries the code that the docs describe. After PR1 merges, we retarget PR2 to main (Task 5).

**Step 1: Create branch from PR1's branch**

```bash
cd "$(git rev-parse --show-toplevel)"
git checkout -b harden/2-docs harden/1-code
```

If `harden/1-code` was deleted post-merge, create from main instead (which now has the code):
```bash
git checkout main && git pull && git checkout -b harden/2-docs
```

**Step 2: Cherry-pick the 3 docs commits**

```bash
git cherry-pick 4235c4c
git cherry-pick cb465e3
git cherry-pick 34e9670
```

Expected: all 3 apply cleanly.

**Step 3: Remove out-of-scope contamination**

Commit `cb465e3` introduced BOTH `fix-robot-probe-and-flash-safety/` AND `harden-harness-and-docs/` OpenSpec artifacts. The former is a different change and must not be in this PR.

```bash
git rm -r --ignore-unmatch openspec/changes/fix-robot-probe-and-flash-safety/
git commit --amend --no-edit
```

The `--ignore-unmatch` makes it safe if the path was already removed by a prior step. This amends the cherry-picked commit to exclude the out-of-scope change.

**Step 4: Run full suite (docs should not break anything)**

```bash
cd "$(git rev-parse --show-toplevel)/harness"
pnpm run build && pnpm run lint && pnpm test
```

Expected: BUILD_EXIT=0, LINT_EXIT=0, 232 tests pass.

Also run markdown lint on touched files:
```bash
cd "$(git rev-parse --show-toplevel)"
pnpm run lint:md
```
Expected: no NEW errors in the files this PR touches (pre-existing errors in out-of-scope files may remain).

**Step 5: Verify no code contamination**

The diff range depends on whether PR1 is still open or already merged:

**Before PR1 merge** (PR2 is based on `harden/1-code`):
```bash
git diff --name-only harden/1-code..harden/2-docs
```

**After PR1 merge + PR2 retargeted/rebased to `main`**:
```bash
git diff --name-only origin/main..harden/2-docs
# or, once PR2 is open on GitHub:
gh pr diff <PR2_NUMBER> --name-only
```

Expected: only docs paths (no harness code):
```
AGENTS.md
docs/plans/2026-07-07-harden-harness-review-fixes.md
openspec/changes/harden-harness-and-docs/apply-progress.md
openspec/changes/harden-harness-and-docs/design.md
openspec/changes/harden-harness-and-docs/proposal.md
openspec/changes/harden-harness-and-docs/spec.md
openspec/changes/harden-harness-and-docs/tasks.md
skills/esp32-arduino-development/SKILL.md
```

If ANY harness code path appears, STOP — contamination occurred.

---

## Task 5: Push PR2 and open the PR

**Step 1: Push branch**

```bash
cd "$(git rev-parse --show-toplevel)"
git push -u origin harden/2-docs
```

**Step 2: Open PR (base = PR1's branch for now; retarget to main after PR1 merges)**

If PR1 is NOT yet merged:
```bash
gh pr create \
  --base harden/1-code \
  --head harden/2-docs \
  --title "docs: correct pin map, add OpenSpec artifacts and apply-progress" \
  --body "..."
```

If PR1 IS merged:
```bash
gh pr create \
  --base main \
  --head harden/2-docs \
  --title "docs: correct pin map, add OpenSpec artifacts and apply-progress" \
  --body "..."
```

PR body:
```
## Summary

Documentation corrections for the harness hardening change: vendor-confirmed pin map, OpenSpec change artifacts, and apply-progress log.

## What (3 commits)

### docs(apply-progress): record post-review fixes (4235c4c)
- Records the 6 post-review fixes with commit SHAs and test count delta (164 → 232)

### docs(openspec): add change artifacts (cb465e3)
- proposal.md, spec.md (18 requirements, RFC 2119), design.md (16 architecture decisions), tasks.md (16 phases)
- NOTE: fix-robot-probe-and-flash-safety/ artifacts from the original commit are EXCLUDED (different change, removed in this branch)

### docs: fix ultrasonic pinout (34e9670)
- AGENTS.md: ultrasonic pins corrected to TRIG 13 / ECHO 14 (were 5/18) — confirmed by vendor sketch 3.1UltrasonicRanging.ino (SHA-256 69244807...)
- AGENTS.md: motor API updated to ACB_SmartCar.Move(direction, speed) — confirmed by 4.3Web_control_car.ino (SHA-256 ddd1b237...)
- Removed duplicate acebott-esp32-flash entry and developer-local file URI links
- skills/esp32-arduino-development/SKILL.md: pinned to esp32:esp32@2.0.18, arduino-cli upload removed, 3.x labeled incompatible
- Adds docs/plans/2026-07-07-harden-harness-review-fixes.md (the implementation plan)

## Evidence

Both vendor sketch SHA-256 hashes independently verified against files on disk.

## Stacked PR note

PR 2 of 2. Builds on PR 1 (harden/1-code). If PR 1 is already merged, this PR targets main directly."
```

**Step 3: Verify PR opened**

```bash
gh pr view --json url,state,number
```

---

## Task 6: Retarget PR2 to main (after PR1 merges)

**This task runs AFTER PR1 is merged into main.** The exact steps depend on how PR1 was merged.

### Step 1a: If PR1 was merged with a regular merge commit

`harden/1-code` remains ancestral to `main`, so a simple retarget works:

```bash
cd "$(git rev-parse --show-toplevel)"
gh pr edit <PR2_NUMBER> --base main
```

GitHub recomputes the diff. Since PR1's commits are now in main, the diff shrinks to just the docs commits.

### Step 1b: If PR1 was squash-merged

The squash commit is NOT ancestral to `harden/1-code`, so GitHub would still show PR1's code changes in PR2's diff. You must rebase PR2 onto the new main first:

```bash
cd "$(git rev-parse --show-toplevel)"
git checkout harden/2-docs
git fetch origin
git rebase --onto origin/main harden/1-code harden/2-docs
git push --force-with-lease
gh pr edit <PR2_NUMBER> --base main
```

The `--onto origin/main harden/1-code` replays only PR2's commits (the docs) on top of the current main, dropping the PR1 code commits that are now in main via squash. `--force-with-lease` is the safe force-push (rejects if the remote moved).

### Step 2: Verify the retarget

```bash
gh pr view <PR2_NUMBER> --json baseRefName,headRefName,mergeable
```
Expected: `baseRefName: main`, `mergeable: MERGEABLE` (may take a few seconds to recompute).

### Step 3: Verify PR2 diff is only docs

```bash
gh pr diff <PR2_NUMBER> --name-only
```
Expected: only the 8 docs paths listed in Task 4 Step 5. If harness code paths appear, the rebase/retarget failed — go back to Step 1a/1b.

---

## Task 7: Final verification

**Step 1: Verify both PRs exist and bases are correct**

```bash
gh pr list --state open --json number,headRefName,baseRefName,url \
  --jq '.[] | select(.headRefName | startswith("harden/")) | "\(.number): \(.headRefName) → \(.baseRefName) \(.url)"'
```

Expected (before PR1 merge):
```
N1: harden/1-code → main <url1>
N2: harden/2-docs → harden/1-code <url2>
```

Expected (after PR1 merge + retarget):
```
N2: harden/2-docs → main <url2>
```

### Step 2: Verify out-of-scope work never entered main

After both PRs merge to main, verify by **paths** (not just SHAs — squash merge renames commits):

**By SHAs** (works if both PRs used regular merge commits):
```bash
git log --oneline c22cfbc..origin/main
```
Must NOT contain `68c69e8` (M3/M4) or `2613dc7` (QD001 skills).

**By paths** (works regardless of merge style — squash-safe):
```bash
git diff --name-only c22cfbc..origin/main
```
Must NOT contain any of these out-of-scope paths:
- `skills/qd001-app-control/`
- `skills/qd001-ir-remote/`
- `skills/qd001-leds-buzzer/`
- `skills/qd001-motors-mecanum/`
- `skills/qd001-sensors/`
- `skills/qd001-servo-scan/`
- `skills/esp32-connectivity/`
- `openspec/changes/fix-robot-probe-and-flash-safety/`
- Any firmware sketch touching M3/M4 motor shift-register bytes

If ANY out-of-scope path appears, the stack leaked — investigate and revert.

**Step 3: Return to main**

```bash
git checkout main
git pull origin main
```

---

## Merge workflow (critical — read before merging)

GitHub does NOT automatically advance stacked PRs. Follow this exactly:

1. **Merge PR1** (`harden/1-code` → `main`).
   - Regular merge commit (recommended) or squash merge both work — see step 2 for the difference.
   - If GitHub offers to delete `harden/1-code`, **decline** (PR2 still bases on it). If auto-delete is configured, re-create the branch from main: `git push origin main:harden/1-code`.
2. **Advance PR2 to main:**
   - If PR1 was a **regular merge**: `gh pr edit <PR2_NUMBER> --base main` (Task 6 Step 1a).
   - If PR1 was **squash-merged**: rebase PR2 onto main, force-push, then retarget (Task 6 Step 1b).
3. **Wait for PR2 checks** to re-run against the new base.
4. **Merge PR2** (`harden/2-docs` → `main`).
5. **Verify main** by paths (Task 7 Step 2) — not just SHAs, in case of squash.

**Do NOT merge PR2 while its base is `harden/1-code`** unless you intend to merge into that branch, not into main.

---

## Rollback

If anything goes wrong:

```bash
# Delete remote branches
git push origin --delete harden/1-code harden/2-docs

# Close PRs
gh pr close <PR1_NUMBER>
gh pr close <PR2_NUMBER>

# Local main is untouched (we only created branches from c22cfbc)
git checkout main
```

No data loss — all commits still exist in main's local history.
