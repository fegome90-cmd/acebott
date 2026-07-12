# Classify Divergent Main Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate the preserved WIP stash into independently reviewable branches without modifying divergent `main`.

**Architecture:** Treat `origin/main` as the base for every thematic branch. Recover tracked files from the stash's main tree and untracked files from its third parent, never applying the mixed stash wholesale. Keep `main`, `backup/main-diverged-20260711`, and `stash@{0}` intact until every recovered branch is verified.

**Tech Stack:** Git, shell, Markdown/OpenSpec documentation, Python, Arduino sketches.

---

### Task 1: Verify preservation preconditions

**Files:** None (read-only).

**Step 1: Confirm active branch and refs**

Run:

```bash
git fetch origin
git status --short --branch
test "$(git branch --show-current)" = "harden/2-docs"
git rev-parse main origin/main backup/main-diverged-20260711
git stash list -1
```

Expected: fetch succeeds; the active branch is `harden/2-docs`; `main` and its backup both resolve to `48fa730`; `stash@{0}` exists.

**Step 2: Refuse to overwrite existing thematic branches**

```bash
for ref in \
  docs/harden-harness-followup \
  feat/qd001-ble-gatt-control \
  experiment/qd010-ps3-validation; do
  if git show-ref --verify --quiet "refs/heads/$ref"; then
    echo "Ref already exists: $ref" >&2
    exit 1
  fi
done
```

Expected: all three refs are absent. If any exists, stop and audit that branch before continuing.

**Step 3: Confirm ignored cache remains excluded**

Run:

```bash
git status --short --ignored
```

Expected: `.pnpm-store/` is not part of the stash recovery scope.

**Step 4: Inventory stash paths**

Run:

```bash
git stash show --name-status --include-untracked stash@{0}
```

Expected groups: hardening docs, BLE GATT files, and QD010 validation sketch.

---

### Task 2: Recover hardening documentation

**Files:**
- Create: `docs/plans/2026-07-08-stacked-prs-hardening.md` (from stash untracked parent)
- Modify: `docs/plans/2026-07-07-harden-harness-review-fixes.md`
- Modify: `openspec/changes/harden-harness-and-docs/apply-progress.md`
- Create: `docs/plans/2026-07-12-classify-divergent-main.md`

**Step 1: Create the thematic branch**

```bash
git switch -c docs/harden-harness-followup origin/main
```

**Step 2: Restore tracked documentation paths only**

```bash
git restore --source=stash@{0} -- \
  docs/plans/2026-07-07-harden-harness-review-fixes.md \
  openspec/changes/harden-harness-and-docs/apply-progress.md
```

**Step 3: Extract the untracked hardening plan from the stash parent**

```bash
mkdir -p docs/plans
git show 'stash@{0}^3:docs/plans/2026-07-08-stacked-prs-hardening.md' \
  > docs/plans/2026-07-08-stacked-prs-hardening.md
```

**Step 4: Add this implementation plan and commit the scoped branch**

```bash
git add \
  docs/plans/2026-07-07-harden-harness-review-fixes.md \
  docs/plans/2026-07-08-stacked-prs-hardening.md \
  docs/plans/2026-07-12-classify-divergent-main.md \
  openspec/changes/harden-harness-and-docs/apply-progress.md
git diff --cached --check
git commit -m "docs(hardening): preserve follow-up plans"
```

**Step 5: Verify the branch scope**

```bash
git show --stat --oneline HEAD
git status --short
```

Expected: only the three hardening plan/progress files plus this plan are committed; no BLE or QD010 paths appear.

---

### Task 3: Recover BLE GATT work

**Files:**
- Modify: `skills/README.md`
- Create: `docs/references/ble-gatt-esp32-ios-robot-control.md`
- Create: `docs/references/ble-motor-control-basic.ino`
- Create: `docs/references/ble_motor_controller.py`
- Create: `docs/references/ios-ble-swift.swift`
- Create: `scripts/ble_client.py`
- Create: `sketches/ble-gatt-control/ble-gatt-control.ino`

**Step 1: Create the thematic branch from origin**

```bash
git switch -c feat/qd001-ble-gatt-control origin/main
```

**Step 2: Restore the tracked README change**

```bash
git restore --source=stash@{0} -- skills/README.md
```

**Step 3: Extract only BLE untracked paths from the stash parent**

```bash
mkdir -p docs/references scripts sketches/ble-gatt-control
git show 'stash@{0}^3:docs/references/ble-gatt-esp32-ios-robot-control.md' \
  > docs/references/ble-gatt-esp32-ios-robot-control.md
git show 'stash@{0}^3:docs/references/ble-motor-control-basic.ino' \
  > docs/references/ble-motor-control-basic.ino
git show 'stash@{0}^3:docs/references/ble_motor_controller.py' \
  > docs/references/ble_motor_controller.py
git show 'stash@{0}^3:docs/references/ios-ble-swift.swift' \
  > docs/references/ios-ble-swift.swift
git show 'stash@{0}^3:scripts/ble_client.py' \
  > scripts/ble_client.py
git show 'stash@{0}^3:sketches/ble-gatt-control/ble-gatt-control.ino' \
  > sketches/ble-gatt-control/ble-gatt-control.ino
```

Do not extract the QD010 sketch or `.pnpm-store/`.

**Step 4: Review and commit the BLE slice**

```bash
git add \
  skills/README.md \
  docs/references/ble-gatt-esp32-ios-robot-control.md \
  docs/references/ble-motor-control-basic.ino \
  docs/references/ble_motor_controller.py \
  docs/references/ios-ble-swift.swift \
  scripts/ble_client.py \
  sketches/ble-gatt-control/ble-gatt-control.ino
git diff --cached --check
git commit -m "feat(qd001): preserve BLE GATT control research"
```

**Step 5: Verify the branch contains only BLE scope**

```bash
git show --stat --oneline HEAD
git status --short
```

---

### Task 4: Recover QD010 validation experiment

**Files:**
- Create: `sketches/qd010-validation/qd010-validation.ino`

**Step 1: Create the experiment branch**

```bash
git switch -c experiment/qd010-ps3-validation origin/main
```

**Step 2: Extract the single untracked sketch from the stash parent**

```bash
mkdir -p sketches/qd010-validation
git show 'stash@{0}^3:sketches/qd010-validation/qd010-validation.ino' \
  > sketches/qd010-validation/qd010-validation.ino
```

**Step 3: Commit and verify the experiment**

```bash
git add sketches/qd010-validation/qd010-validation.ino
git diff --cached --check
git commit -m "feat(qd010): preserve PS3 validation sketch"
git show --stat --oneline HEAD
git status --short
```

---

### Task 5: Verify all preservation invariants

**Files:** None (read-only verification).

**Step 1: Confirm `main` was not changed**

```bash
test "$(git rev-parse main)" = "$(git rev-parse backup/main-diverged-20260711)"
test "$(git rev-parse main)" = "48fa73042e822558727de859cd9b96a06417d801"
```

**Step 2: Confirm each thematic branch is based on origin**

```bash
git merge-base --is-ancestor origin/main docs/harden-harness-followup
git merge-base --is-ancestor origin/main feat/qd001-ble-gatt-control
git merge-base --is-ancestor origin/main experiment/qd010-ps3-validation
```

**Step 3: Confirm stash remains available**

```bash
git stash list -1
git stash show --name-status --include-untracked stash@{0}
```

Expected: stash remains intact until a human reviews all three recovered branches.

**Step 4: Confirm recovered blobs match the preserved stash**

```bash
test "$(git rev-parse 'docs/harden-harness-followup:docs/plans/2026-07-07-harden-harness-review-fixes.md')" = \
  "$(git rev-parse 'stash@{0}:docs/plans/2026-07-07-harden-harness-review-fixes.md')"
test "$(git rev-parse 'docs/harden-harness-followup:docs/plans/2026-07-08-stacked-prs-hardening.md')" = \
  "$(git rev-parse 'stash@{0}^3:docs/plans/2026-07-08-stacked-prs-hardening.md')"
test "$(git rev-parse 'docs/harden-harness-followup:openspec/changes/harden-harness-and-docs/apply-progress.md')" = \
  "$(git rev-parse 'stash@{0}:openspec/changes/harden-harness-and-docs/apply-progress.md')"
test "$(git rev-parse 'feat/qd001-ble-gatt-control:skills/README.md')" = \
  "$(git rev-parse 'stash@{0}:skills/README.md')"
test "$(git rev-parse 'feat/qd001-ble-gatt-control:docs/references/ble-gatt-esp32-ios-robot-control.md')" = \
  "$(git rev-parse 'stash@{0}^3:docs/references/ble-gatt-esp32-ios-robot-control.md')"
test "$(git rev-parse 'feat/qd001-ble-gatt-control:docs/references/ble-motor-control-basic.ino')" = \
  "$(git rev-parse 'stash@{0}^3:docs/references/ble-motor-control-basic.ino')"
test "$(git rev-parse 'feat/qd001-ble-gatt-control:docs/references/ble_motor_controller.py')" = \
  "$(git rev-parse 'stash@{0}^3:docs/references/ble_motor_controller.py')"
test "$(git rev-parse 'feat/qd001-ble-gatt-control:docs/references/ios-ble-swift.swift')" = \
  "$(git rev-parse 'stash@{0}^3:docs/references/ios-ble-swift.swift')"
test "$(git rev-parse 'feat/qd001-ble-gatt-control:scripts/ble_client.py')" = \
  "$(git rev-parse 'stash@{0}^3:scripts/ble_client.py')"
test "$(git rev-parse 'feat/qd001-ble-gatt-control:sketches/ble-gatt-control/ble-gatt-control.ino')" = \
  "$(git rev-parse 'stash@{0}^3:sketches/ble-gatt-control/ble-gatt-control.ino')"
test "$(git rev-parse 'experiment/qd010-ps3-validation:sketches/qd010-validation/qd010-validation.ino')" = \
  "$(git rev-parse 'stash@{0}^3:sketches/qd010-validation/qd010-validation.ino')"
```

Expected: every `test` exits zero, proving the branch blobs match the preserved work exactly.

**Step 5: Return to the original branch**

```bash
git switch harden/2-docs
git status --short --branch
```

Expected: the original branch is active again and only the intentionally excluded `.pnpm-store/` remains untracked.

---

### Task 6: Defer main synchronization until review

Do not run `git reset --hard origin/main` in this plan. That operation remains a separate, explicitly approved step after branch review and any PR preservation. The final state must retain the backup and stash until that review is complete.
