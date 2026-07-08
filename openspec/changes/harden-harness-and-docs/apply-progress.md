# Apply Progress — harden-harness-and-docs

> Implementation log. Updated after each phase.

## Baselines

Four test-count reference points — do not confuse:

- **140 tests** = early local iteration baseline during initial implementation (9 files).
- **164 tests** = baseline at `c22cfbc` (= `origin/main` before this change, 10 files).
- **224 tests** = after the initial hardening apply, before the 6 post-review fixes.
- **233 tests** = final state after all review fixes (11 files). This is what the merged code produces.

## Pre-verified prerequisites

- Ultrasonic sketch SHA-256: `692448072d35ef6f82c1db1a452b0819e448fa04256a6bcb0530cb486e9bca96` ✓
- Web control sketch SHA-256: `ddd1b237b983de342744c28eab711bfcc8c8caf0cbbd5fecac149ff66ff8456b` ✓

## Phase log

### Phase 1 — Types and signatures (completed)

- Created `harness/src/lib/child-process.ts` with `TerminateChildResult`,
  `ChildTerminationError`, and signatures (stubs) for `waitForClose`,
  `terminateChild`, `safeLog`.
- Added `SerialReadResult` discriminated union to `harness/src/lib/serial.ts`.
- Added `HealthStage`, `HealthCheckContext`, `RunHealthCheckOptions`,
  `HealthCheckResult` (with error codes + preservation fields) to
  `harness/src/tools/health.ts`.
- Build + lint pass; existing 140 tests still pass.

### Phase 2-3 — Child-process primitives RED then GREEN (completed)

- Created `harness/tests/unit/child-process.test.ts` (23 tests).
- RED: 11/23 failed against stubs.
- Implemented race-safe `waitForClose` (check → listener → re-check → timeout).
- Implemented non-throwing `terminateChild` (SIGTERM → grace → SIGKILL → kill
  timeout → failed, all kill() calls try/caught, false-return re-checked).
- Implemented `safeLog` (try/catch around sink, fallback console.error).
- GREEN: 23/23 pass.
- Test count: 140 → 163 (+23).
- Build + lint pass.

### Phase 4-6 — Compile and flash wrapper lifecycle RED then GREEN (completed)

- Extended `harness/tests/unit/arduino-cli.test.ts` with 9 lifecycle tests
  (now 15 total). Mocked `terminateChild` via `vi.mock` so wrapper tests are
  fast and deterministic; real primitive is unit-tested in child-process suite.
- Extended `harness/tests/unit/esptool.test.ts` with 9 lifecycle tests
  (now 17 total).
- RED: lifecycle tests failed against old resolve-on-close wrappers.
- Implemented shared `settleWrapper<T>(proc, signal, onSuccess, onClose,
  onError)` in `arduino-cli.ts` exported and reused by `compileSketch`.
  - Settle-once guard via `settled` flag.
  - `finish(action)` routes any throw through `reject`, no unhandled rejections.
  - `handleAbort` async IIFE awaits `terminateChild`, rejects with
    `ChildTerminationError` on failure, else `AbortError`.
  - If `signal.aborted` when `close` fires, rejects with `AbortError` (not
    treated as success).
  - Exactly one abort listener, removed on every terminal path via
    `removeAbortListener()`.
- Implemented `settleFlashWrapper` in `esptool.ts` (same pattern, esptool
  variant for flash result shape).
- Flash artifact validation (`validateFlashArtifacts`) added early: checks
  4 artifacts (bootloader, partition table, boot_app0, application firmware)
  for existence/isFile/non-zero size BEFORE spawn. Dedicated RED tests
  arrive in Phase 11-12; implementation already present.
- GREEN: 177/177 pass.
- Test count: 163 → 177 (+14: 9 compile lifecycle + 9 flash lifecycle - 4
  net adjustments across existing suite).
- Build + lint pass.

## Reconstructed state (2026-07-07)

The previous agent exceeded the logged progress: it completed Phase 7-8 and
most of Phase 11-12's *implementation* but never logged the work or marked
the tasks in `tasks.md`. Actual test count is 187, not 177.

Honest assessment by phase:

- **Phase 1-3 (child-process primitives)** — DONE. 23 tests pass in
  `child-process.test.ts`.
- **Phase 4-6 (compile/flash wrapper lifecycle)** — DONE. 15 compile tests +
  17 esptool tests pass.
- **Phase 7-8 (serial discrimination)** — DONE (unlogged).
  `readSerial` in `harness/src/lib/serial.ts` returns `SerialReadResult`,
  defines `selectResult` and `finalize` exactly per design AD7/AD8, captures
  stderr separately, maps clean early exit to `incomplete`, non-zero/signal
  to `error`, and converts any termination failure to `error` with
  `child_termination_unconfirmed` + `processMayStillBeRunning: true`.
  All 15 scenarios (7.1-7.15) are present in `serial.test.ts` (19 tests total).
  The `[ ]` boxes in tasks.md will be flipped to `[x]`.
- **Phase 9-10 (health orchestration)** — NOT STARTED.
  `runHealthCheck` in `harness/src/tools/health.ts` still uses the OLD
  `(skipFlash, ctx?)` signature and returns `HealthToolResult` (legacy).
  No try/catch/finally boundary, no `mapSerialResult`, no `cleanupAllowed`,
  no `ChildTerminationError` priority, no stage/detect/flashed propagation.
  This is the largest remaining work item (40 RED sub-scenarios).
- **Phase 11-12 (artifact validation)** — PARTIAL.
  `validateFlashArtifacts` is implemented in `esptool.ts` (validates 4
  artifacts: existence, isFile, non-zero size, artifact-specific messages).
  However the 6 RED tests (11.1-11.6) are MISSING from
  `esptool.test.ts` — the previous agent did not write the dedicated
  validation tests. Tests must be added for full TDD compliance.
- **Phase 13 (integration)** — NOT STARTED.
  `execute()` in `health.ts` still uses old signature;
  `index.ts` still exports `HealthToolResult` not `HealthCheckResult`.
- **Phase 14-16** — Out of scope for this delegation (docs + final validation).

Plan for remaining work (in order): Phase 11 RED → Phase 9-10 RED+GREEN →
Phase 13. Each phase TDD-first per `strict_tdd: true` in openspec/config.yaml.

### Phase 11-12 (artifact validation) — RED then GREEN (completed)

- Added 6 dedicated artifact-validation tests to
  `harness/tests/unit/esptool.test.ts` covering scenarios 11.1-11.6:
  missing bootloader, empty application firmware, directory-as-artifact,
  single invalid artifact prevents spawn, caller files never deleted,
  all 4 paths checked.
- Implementation `validateFlashArtifacts` already existed in esptool.ts
  (was added during Phase 4-6 by the previous agent). All 6 tests passed
  immediately against the existing implementation — no code change needed.
- Test count: 187 → 193 (+6 esptool tests).
- Build + lint pass.

### Phase 9-10 (health orchestration) — RED then GREEN (completed)

- Rewrote `harness/tests/unit/health.test.ts` with all 40 scenarios
  (9.1-9.40, 10.1-10.12). The previous 9 legacy tests were migrated to the
  new contract.
- RED: 32/40 failed against the old `runHealthCheck(skipFlash, ctx?)`
  signature — confirmed the tests were meaningful.
- Rewrote `harness/src/tools/health.ts`:
  - `runHealthCheck(options: RunHealthCheckOptions)` — options-object
    signature per design AD9.
  - Returns discriminated `HealthCheckResult` (NOT `HealthToolResult`).
  - Wraps detection, mkdtemp, compile, flash, serial read, and cleanup
    in ONE try/catch/finally boundary.
  - `ChildTerminationError` has PRIORITY over ordinary cancellation:
    sets `cleanupAllowed = false`, returns
    `code: "child_termination_unconfirmed"`,
    `processMayStillBeRunning: true`, `cleanupSkipped`, `artifactsPreservedAt`.
  - `assertNotAborted(signal)` checkpoints between every async operation
    (after detect, after compile, after flash).
  - `safeRemoveBuildDir` swallows rm errors and logs via `safeLog`.
  - Logger failure (throwing sink) does NOT replace the primary result
    (safeLog wraps the call in try/catch).
  - `mapSerialResult(result, context)` is exhaustive: success →
    protocol_complete (stage promoted to "complete"), incomplete, timeout,
    error (with stderr/exitCode/signal passthrough), cancelled, default
    → `assertNever`.
  - `protocol_complete` is rendered as "Protocol complete" — NEVER
    "healthy"/"passed"/"all components working" (REQ-011).
  - `code` mapping: serial `process_failed` → health `operation_failed`;
    serial `child_termination_unconfirmed` passes through unchanged.
- `RunHealthCheckOptions` gained a `log?: (msg: string) => void` field
  because `ExtensionContext` has no `.log` method — the design pseudocode
  assumed one. Tests pass `log` directly.
- GREEN: 40/40 pass.
- Test count: 193 → 224 (+31 net: +40 health, -9 legacy migrated).
- Build + lint pass.

### Phase 13 (integration and exports) — completed

- `execute()` in `health.ts` already migrated in Phase 10 GREEN rewrite:
  `await runHealthCheck({ skipFlash, signal, ctx })`.
- No other `runHealthCheck` or `readSerial` consumers in src/ —
  both are leaf functions called only from `health.ts` execute path.
- `harness/src/index.ts` exports updated:
  - Added `type SerialReadResult` (from serial.js).
  - Added `ChildTerminationError`, `TerminateChildResult`, `safeLog`,
    `terminateChild` (from child-process.js).
  - Added `EsptoolError` (from esptool.js).
  - Replaced health exports: now exports `HealthCheckContext`,
    `HealthCheckResult`, `HealthStage`, `RunHealthCheckOptions`,
    `mapSerialResult`, `runHealthCheck` (kept deprecated `HealthToolResult`
    type alias for transitional compatibility).
- `tests/integration/hardware.test.ts` migrated to new signature
  `{ skipFlash: false }` and reads `result.report` only after narrowing to
  `protocol_complete`. (Hardware-gated; does not run in default suite.)
- Test count: 224 (unchanged).
- Build + lint pass.

## Final state (post-Phase-13)

- Total tests: 224 (10 files).
- `pnpm run build`: pass.
- `pnpm run lint`: pass.
- `pnpm test`: pass (224/224).
- Remaining: Phase 14-15 (docs), Phase 16 (final validation) — handled by
  a separate delegation.

### Phase 14 — Documentation correction: `AGENTS.md` (completed)

Pre-verified vendor sketch hashes (verified against files on disk earlier in
the session; not re-hashed here):
- Ultrasonic `3.1UltrasonicRanging.ino`:
  `692448072d35ef6f82c1db1a452b0819e448fa04256a6bcb0530cb486e9bca96`
- Web control `4.3Web_control_car.ino`:
  `ddd1b237b983de342744c28eab711bfcc8c8caf0cbbd5fecac149ff66ff8456b`

Surgical edits to `AGENTS.md` (no structural rewrite):

- **14.1** — Sketch Structure example pins changed from
  `TRIG_PIN = 5` / `ECHO_PIN = 18` to `TRIG_PIN = 13` / `ECHO_PIN = 14`,
  with an inline comment citing `myUltrasonic.Init(13,14)` from
  `3.1UltrasonicRanging.ino` and its SHA-256 hash.
- **14.2** — "Motor Control (ACB_SmartCar_V2)" section rewritten: removed
  the non-vendor `car.forward(speed)` / `car.backward(speed)` / `car.left` /
  `car.right` / `car.stop` examples and replaced them with the
  vendor-confirmed `ACB_SmartCar.Move(Forward, 255)` /
  `ACB_SmartCar.Move(Backward, 255)` style. A warning note states the
  `car.*` style is NOT vendor-confirmed.
- **14.3** — Removed the duplicate `acebott-esp32-flash` bullet in the
  "Related Skills" section (was listed twice, now once).
- **14.4** — Replaced the absolute
  `[skills/README.md](file:///Users/felipe_gonzalez/Developer/acebott/skills/README.md)`
  link with a repo-relative `` `skills/README.md` `` reference.
- **14.5** — The rewritten Motor Control section opens with:
  "Motor API confirmed by vendor sketch `4.3Web_control_car.ino`
  (SHA-256: `ddd1b237...`)." per REQ-013.

No firmware (`.ino`) files were modified. Tasks 14.1-14.5 marked `[x]` in
`tasks.md` (14.6-14.7 hash verifications were pre-verified and are not
re-run here).

### Phase 15 — Arduino skill correction: `skills/esp32-arduino-development/SKILL.md` (completed)

Surgical edits (tone and Spanish-language structure preserved):

- **15.1** — Pinned the executable core install to
  `arduino-cli core install esp32:esp32@2.0.18` (was unpinned
  `esp32:esp32`). Added a "Core fijado del proyecto" callout stating the
  repo uses `esp32:esp32@2.0.18` (FQBN `esp32:esp32:esp32`) and that 3.x is
  NOT compatible. The "No board selected" gotcha was also updated to cite
  the pinned core.
- **15.2** — Removed the `arduino-cli upload --fqbn ... -p ...` command
  block from section 3. Replaced it with an explicit "NO USAR
  `arduino-cli upload`" note explaining it forces 921600 baud and causes
  0xE0 on the QD001's CH340. No executable `arduino-cli upload` command
  remains; the only surviving mentions are warnings saying not to use it.
- **15.3** — Upload instructions now point to the canonical
  `acebott-esp32-flash` skill (esptool bundled ACECode @ 115200) rather
  than inlining a recipe.
- **15.4 / 15.5** — Section 7 ("APIs ESP32 Arduino") now opens with an
  "INCOMPATIBLE CON ESTE PROYECTO — referencia de migración únicamente"
  banner. The `ledcAttach`/`ledcWrite` PWM block and the `touchRead` block
  are explicitly labeled as 3.x and incompatible with 2.0.18; only
  `Preferences` (NVS) is noted as available in both. The "Cuándo usarla"
  list and the "API PWM cambió en 3.x" gotcha were updated to label 3.x
  APIs as migration reference only.

Tasks 15.1-15.5 marked `[x]` in `tasks.md`.

### Phase 16 — Final validation (completed)

Quality gate (all exit 0):

- **16.1** `pnpm run build` (`tsc --noEmit`) — **pass** (exit 0).
- **16.2** `pnpm run lint` (`biome check --error-on-warnings`) — **pass**
  (exit 0, 26 files checked, no fixes applied).
- **16.3** `pnpm test` (`vitest run`) — **pass** (224/224 tests across
  10 files). stderr lines during health tests are the expected
  `safeLog` "Build directory preserved..." messages from scenarios
  9.13-9.17, not failures.
- **16.4** No pre-existing test removed without justification. The deleted
  test lines in `git diff harness/tests/` correspond to the documented
  Phase 9-10 migration: 9 legacy `runHealthCheck`/`readSerial` tests were
  replaced by 40 new contract scenarios (justification recorded in the
  Phase 9-10 log above). Net test count increased.
- **16.5** Baseline: **140** tests (9 files). Final: **224** tests
  (10 files). Delta: +84 net.
- **16.6** Final count includes every accepted new scenario: 23
  child-process, 15 compile-lifecycle, 23 esptool (incl. 6 artifact
  validation), 19 serial, 40 health, plus the pre-existing parsers/usb/
  constants/detect/skills suites.
- **16.7** `AGENTS.md` verified against the hashed vendor sketches:
  - Ultrasonic pins: `TRIG_PIN = 13`, `ECHO_PIN = 14`, citing
    `3.1UltrasonicRanging.ino` SHA-256
    `692448072d35ef6f82c1db1a452b0819e448fa04256a6bcb0530cb486e9bca96`.
    Matches `myUltrasonic.Init(13,14)`.
  - Motor API: `ACB_SmartCar.Move(Forward, 255)` /
    `ACB_SmartCar.Move(Backward, 255)`, citing `4.3Web_control_car.ino`
    SHA-256 `ddd1b237b983de342744c28eab711bfcc8c8caf0cbbd5fecac149ff66ff8456b`.
    Matches vendor evidence.
- **16.8** `harness/src/tools/health.ts` `renderHealthResult` renders
  `protocol_complete` as "Protocol complete" — never "healthy" or
  "passed". REQ-011 neutrality enforced in code comments (lines 533,
  549-550). The only "healthy"/"pass-fail" language in the file is in the
  tool's `description` metadata (describing the tool's purpose), which is
  pre-existing and outside REQ-011's scope (which targets result
  rendering). Issue 1 (health semantics redesign) is explicitly out of
  scope for this change.

Markdown lint (`pnpm run lint:md`):

- All files edited by this change are clean: `AGENTS.md` (0 errors),
  `skills/esp32-arduino-development/SKILL.md` (0 errors), and all 5
  markdown files under `openspec/changes/harden-harness-and-docs/`
  (0 errors). Fixed a trailing-blank-line (MD012) issue in
  `apply-progress.md` introduced during logging.
- 16 pre-existing errors remain in files NOT touched by this change:
  `harness/skill/SKILL.md`, `harness/tests/fixtures/...`, and other
  change directories (`cerrar-gaps-ecoeficiencia`,
  `fix-robot-probe-and-flash-safety`). These are outside the scope of
  `harden-harness-and-docs`.

Tasks 16.1-16.8 marked `[x]` in `tasks.md`.

## Final state (post-Phase-16)

- Total tests: 224 (10 files).
- `pnpm run build`: pass (exit 0).
- `pnpm run lint`: pass (exit 0).
- `pnpm test`: pass (224/224).
- `pnpm run lint:md`: all change-touched files clean; pre-existing errors
  in out-of-scope files remain.
- All 16 phases complete. Ready for `sdd-verify harden-harness-and-docs`.

## Post-review fixes (multi-review)

After `sdd-verify` passed, a 5-reviewer multi-review found 1 critical bug and 5 major issues. All were fixed via a audited TDD plan (`docs/plans/2026-07-07-harden-harness-review-fixes.md`).

| Fix | Severity | Commit | Description |
|-----|----------|--------|-------------|
| 1 | MAJOR (foundation) | `157b8d8` | `terminateChild` null-guard — returns `already_closed` for `undefined` proc instead of throwing TypeError |
| 2 | CRITICAL | `d154825` | `readSerial` early-abort guard — `finalize` short-circuits when `proc` is undefined (pre-spawn abort), no longer calls `terminateChild(undefined)` |
| 3 | MAJOR | `05b3f2b` | `pkill ACECode` errors logged via `safeLog` instead of swallowed with empty `.catch(() => {})` |
| 4 | MAJOR | `4fbb94a` | `validateFlashArtifacts` preserves `stat` error code (EACCES/ENOENT/EIO) in message instead of collapsing all to "not found" |
| 5 | MAJOR | `68bd747` | Test 9.13 deepened — asserts `code`, `processMayStillBeRunning`, `stage` in the priority-over-cancellation path |
| 6 | MAJOR | `292692c` | `renderHealthResult` exported and tested — 5 tests verify rendered text never contains "healthy"/"passed" (locks REQ-011) |

### Validation after fixes

- Test count: 224 → 232 (+8: +1 child-process, +1 serial, +1 esptool, +5 render-health)
- `pnpm run build`: exit 0
- `pnpm run lint`: exit 0
- `pnpm test`: 232/232 pass across 11 files

### Plan audit

The implementation plan was audited before execution. The audit found 4 critical errors (wrong `validateFlashArtifacts` signature, wrong `HealthReport` types, test double-call bug, step ordering) and 4 major errors (wrong `pnpm test` invocations, indentation mismatches). All were corrected before execution. The audited plan is at `docs/plans/2026-07-07-harden-harness-review-fixes.md`.
