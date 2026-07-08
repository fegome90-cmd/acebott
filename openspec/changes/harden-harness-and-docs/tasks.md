# Tasks — harden-harness-and-docs

## Phase 1 — Types and signatures

- [x] 1.1 Create `harness/src/lib/child-process.ts`.
- [x] 1.2 Define `TerminateChildResult`.
- [x] 1.3 Define `ChildTerminationError`.
- [x] 1.4 Define signatures for `waitForClose`, `terminateChild`, and `safeLog` without functional implementation.
- [x] 1.5 Add `SerialReadResult` to `serial.ts`.
- [x] 1.6 Add `HealthStage`, `HealthCheckContext`, `RunHealthCheckOptions`, and `HealthCheckResult` to `health.ts`.
- [x] 1.7 Add error codes and preservation fields to `HealthCheckResult.error`.

## Phase 2 — Child-process primitives: RED

- [x] 2.1 Already-closed process returns `already_closed` and sends no signal.
- [x] 2.2 SIGTERM closure returns `terminated` and sends no SIGKILL.
- [x] 2.3 Failed SIGTERM escalates to SIGKILL.
- [x] 2.4 Closure between initial check and listener registration is observed without waiting for timeout.
- [x] 2.5 `kill()` returning false followed by confirmed closure is not reported as failure.
- [x] 2.6 SIGTERM throwing returns controlled `failed`.
- [x] 2.7 SIGKILL throwing returns controlled `failed`.
- [x] 2.8 No closure after SIGKILL timeout returns `failed`.
- [x] 2.9 `waitForClose` removes its listener and clears its timer after closure.
- [x] 2.10 `waitForClose` removes its listener and clears its timer after timeout.

## Phase 3 — Child-process primitives: GREEN

- [x] 3.1 Implement race-safe `waitForClose`.
- [x] 3.2 Implement non-throwing `terminateChild`.
- [x] 3.3 Implement `safeLog`.
- [x] 3.4 Verify all child-process tests pass.

## Phase 4 — Compile wrapper lifecycle: RED

- [x] 4.1 Abort sends SIGTERM to the compile process.
- [x] 4.2 Failed SIGTERM escalates to SIGKILL.
- [x] 4.3 Unconfirmed termination rejects with `ChildTerminationError`.
- [x] 4.4 The wrapper does not settle before `close`.
- [x] 4.5 Abort and close race settles exactly once.
- [x] 4.6 Abort and process-error race settles exactly once.
- [x] 4.7 Failure inside the asynchronous abort path rejects the wrapper promise and creates no unhandled rejection.
- [x] 4.8 Abort listener is removed after normal completion.

## Phase 5 — Flash wrapper lifecycle: RED

- [x] 5.1 Abort sends SIGTERM to the esptool process.
- [x] 5.2 Failed SIGTERM escalates to SIGKILL.
- [x] 5.3 Unconfirmed termination rejects with `ChildTerminationError`.
- [x] 5.4 The wrapper does not settle before `close`.
- [x] 5.5 Abort and close race settles exactly once.
- [x] 5.6 Abort and process-error race settles exactly once.
- [x] 5.7 Failure inside the asynchronous abort path rejects the wrapper promise and creates no unhandled rejection.
- [x] 5.8 Abort listener is removed after normal completion.

## Phase 6 — Compile and flash wrapper lifecycle: GREEN

- [x] 6.1 Implement a controlled settle-once promise in `compileSketch`.
- [x] 6.2 Integrate `terminateChild` into `compileSketch`.
- [x] 6.3 Implement a controlled settle-once promise in `flashSketch`.
- [x] 6.4 Integrate `terminateChild` into `flashSketch`.
- [x] 6.5 Ensure both wrappers reject with `AbortError` only after termination is confirmed.
- [x] 6.6 Ensure both wrappers reject with `ChildTerminationError` when termination cannot be confirmed.
- [x] 6.7 Verify all compile and flash lifecycle tests pass.

## Phase 7 — Serial discrimination and teardown: RED

- [x] 7.1 Stop predicate reached returns `success`.
- [x] 7.2 Exit code 0 without marker returns `incomplete` with `exitCode: 0`.
- [x] 7.3 Non-zero exit returns `error` with stderr and exit code.
- [x] 7.4 Spawn failure returns `error`.
- [x] 7.5 Timeout returns `timeout` with partial data.
- [x] 7.6 Abort before start returns `cancelled`.
- [x] 7.7 Abort before timeout callback returns `cancelled`.
- [x] 7.8 Timeout selected before abort remains `timeout`.
- [x] 7.9 Stop predicate selected before close remains `success`.
- [x] 7.10 Listeners and timer are removed before final resolution.
- [x] 7.11 Final result resolves exactly once.
- [x] 7.12 Termination failure after selected success returns `error`.
- [x] 7.13 Termination failure after selected timeout returns `error`.
- [x] 7.14 Termination failure after selected cancellation returns `error`.
- [x] 7.15 Termination-failure result includes `child_termination_unconfirmed` and `processMayStillBeRunning: true`.

## Phase 8 — Serial discrimination and teardown: GREEN

- [x] 8.1 Implement settle-once `selectResult`.
- [x] 8.2 Implement `finalize`.
- [x] 8.3 Capture stderr separately from formatted error text.
- [x] 8.4 Map clean early exit to `incomplete`.
- [x] 8.5 Map non-zero exit and unexpected signal to `error`.
- [x] 8.6 Preserve partial data for timeout, error, and cancellation.
- [x] 8.7 Convert every unconfirmed child termination to `error`.
- [x] 8.8 Verify all serial tests pass.

## Phase 9 — Health orchestration: RED

### Early errors

- [x] 9.1 Detection failure returns `error`, stage `detect`, no detect result, and `flashed: false`.
- [x] 9.2 Abort before detection calls no downstream operation and returns `cancelled`.
- [x] 9.3 Abort during detection is observed after detection completes and prevents compile, flash, and serial.
- [x] 9.4 `mkdtemp` failure returns `error`, stage `compile`, and `flashed: false`.

### `skipFlash`

- [x] 9.5 `skipFlash: true` calls no `mkdtemp`, compile, or flash.
- [x] 9.6 `skipFlash: true` still calls serial.
- [x] 9.7 Serial timeout under `skipFlash: true` returns stage `serial` and `flashed: false`.

### Cancellation checkpoints

- [x] 9.8 Cancellation after compile prevents flash and serial.
- [x] 9.9 Cancellation after flash prevents serial.
- [x] 9.10 AbortError from compile maps to `cancelled`.
- [x] 9.11 AbortError from flash maps to `cancelled`.
- [x] 9.12 The same signal is passed to compile, flash, and serial.

### Termination-failure priority

- [x] 9.13 `ChildTerminationError` plus an aborted signal returns `error`, not `cancelled`.
- [x] 9.14 The result includes `code: "child_termination_unconfirmed"`.
- [x] 9.15 The result includes `processMayStillBeRunning: true`.
- [x] 9.16 Cleanup is skipped.
- [x] 9.17 The exact preserved build-directory path is returned.
- [x] 9.18 The exact preserved build-directory path is logged.

### Cleanup

- [x] 9.19 Temporary directory is removed after protocol completion.
- [x] 9.20 Temporary directory is removed after compile error.
- [x] 9.21 Temporary directory is removed after flash error.
- [x] 9.22 Temporary directory is removed after serial error.
- [x] 9.23 Temporary directory is removed after ordinary cancellation.
- [x] 9.24 `rm` failure after protocol completion preserves the primary result and logs the error.
- [x] 9.25 `rm` failure after operation error preserves the primary error and logs the cleanup error.
- [x] 9.26 A throwing logger does not replace the primary result.

### Stages and flash state

- [x] 9.27 Compile error returns stage `compile`, `flashed: false`.
- [x] 9.28 Flash error returns stage `flash`, `flashed: false`.
- [x] 9.29 Serial timeout after successful flash returns stage `serial`, `flashed: true`.
- [x] 9.30 Serial cancellation returns stage `serial`.
- [x] 9.31 Only protocol completion returns stage `complete`.
- [x] 9.32 `flashed` becomes true only after `flashSketch` resolves successfully.

### Result mapping

- [x] 9.33 Serial success maps to `protocol_complete` and parsed report.
- [x] 9.34 Serial incomplete maps to `incomplete`.
- [x] 9.35 Serial timeout maps to `timeout`.
- [x] 9.36 Serial error preserves stderr, exit code, signal, code, and process-state metadata.
- [x] 9.37 Serial cancelled maps to `cancelled`.
- [x] 9.38 Unknown status reaches `assertNever` through a deliberate test cast.
- [x] 9.39 Every result variant includes stage, detect, and flashed.

### Presentation semantics

- [x] 9.40 `protocol_complete` is not rendered as "healthy", "passed", or equivalent diagnostic language.

## Phase 10 — Health orchestration: GREEN

- [x] 10.1 Implement full `runHealthCheck` try/catch/finally boundary.
- [x] 10.2 Implement options-object signature.
- [x] 10.3 Implement cancellation checkpoints.
- [x] 10.4 Handle `ChildTerminationError` before AbortError.
- [x] 10.5 Implement `cleanupAllowed`.
- [x] 10.6 Implement exact artifact-preservation reporting.
- [x] 10.7 Implement safe cleanup and safe logging.
- [x] 10.8 Implement `skipFlash` semantics.
- [x] 10.9 Implement stage and flashed transitions.
- [x] 10.10 Implement exhaustive `mapSerialResult`.
- [x] 10.11 Update user-facing text to remain diagnostically neutral.
- [x] 10.12 Verify all health tests pass.

## Phase 11 — Flash artifact validation: RED

- [x] 11.1 Missing bootloader raises artifact-specific `EsptoolError`.
- [x] 11.2 Empty application firmware raises artifact-specific `EsptoolError`.
- [x] 11.3 Directory supplied as artifact raises `EsptoolError`.
- [x] 11.4 Any single invalid artifact prevents esptool spawn.
- [x] 11.5 Caller-owned files are never deleted by validation.
- [x] 11.6 All four required artifact paths are checked.

## Phase 12 — Flash artifact validation: GREEN

- [x] 12.1 Validate existence.
- [x] 12.2 Validate `stat.isFile()`.
- [x] 12.3 Validate non-zero size.
- [x] 12.4 Produce artifact-specific error messages.
- [x] 12.5 Verify all artifact tests pass.

## Phase 13 — Integration and exports

- [x] 13.1 Update `execute()` to pass `{skipFlash, signal, ctx}`.
- [x] 13.2 Update all `readSerial` consumers.
- [x] 13.3 Update all `runHealthCheck` consumers.
- [x] 13.4 Export new internal types and errors from `index.ts` where required.
- [x] 13.5 Run the complete unit suite and resolve interaction failures.

## Phase 14 — Documentation correction

### `AGENTS.md`

- [x] 14.1 Change ultrasonic pins to TRIG 13 and ECHO 14.
- [x] 14.2 Replace unsupported motor examples with `ACB_SmartCar.Move(direction, speed)`.
- [x] 14.3 Remove duplicate `acebott-esp32-flash` entry.
- [x] 14.4 Remove absolute `file:///Users/felipe_gonzalez/...` link.
- [x] 14.5 State that motor API usage is confirmed by vendor sketches.

### Evidence verification

- [x] 14.6 Verify SHA-256 of the ultrasonic vendor sketch: `692448072d35ef6f82c1db1a452b0819e448fa04256a6bcb0530cb486e9bca96`.
- [x] 14.7 Verify SHA-256 of the web-control vendor sketch: `ddd1b237b983de342744c28eab711bfcc8c8caf0cbbd5fecac149ff66ff8456b`.

## Phase 15 — Arduino skill correction

- [x] 15.1 Pin executable installation instructions to `esp32:esp32@2.0.18`.
- [x] 15.2 Remove `arduino-cli upload`.
- [x] 15.3 Ensure project upload instructions use the approved esptool path.
- [x] 15.4 Label Arduino-ESP32 3.x APIs as incompatible reference or migration guidance.
- [x] 15.5 Ensure 3.x code is not presented as directly executable for this project.

## Phase 16 — Final validation

- [x] 16.1 Run `cd harness && pnpm run build`; exit code must be 0.
- [x] 16.2 Run `cd harness && pnpm run lint`; exit code must be 0.
- [x] 16.3 Run `cd harness && pnpm run test`; all tests must pass.
- [x] 16.4 Confirm no pre-existing test was removed without written justification.
- [x] 16.5 Record the exact baseline and final test counts.
- [x] 16.6 Confirm the final count includes every accepted new scenario.
- [x] 16.7 Verify `AGENTS.md` against the hashed vendor sketches.
- [x] 16.8 Verify that user-facing output never equates `protocol_complete` with hardware health.
