# Proposal — harden-harness-and-docs

> SDD proposal for correcting high-severity audit findings in the ACEBOTT harness and its operational documentation.

## Change

`harden-harness-and-docs`

Address audit issues 3–6 and 8 identified in the static audit of `fegome90-cmd/acebott` at commit `c22cfbc`.

## Motivation

The audit identified two blocking findings and six high or medium-high findings.

This change addresses:

- **Issue 3:** Cancellation is not propagated safely from the health tool.
- **Issue 4:** Serial failures are indistinguishable from valid "no data" outcomes.
- **Issue 5:** The esptool wrapper does not validate flash artifacts before invocation.
- **Issue 6:** `AGENTS.md` contradicts the verified hardware map and motor API.
- **Issue 8:** Arduino skills mix project-compatible core 2.0.18 instructions with incompatible 3.x APIs.

The following findings remain deliberately outside this change:

- **Issue 1:** `robot_health` semantics and unconditional firmware `pass`.
- **Issue 2:** Safe device identification and destructive-flash confirmation.
- **Issue 7:** Mecanum vector correction pending controlled hardware validation.
- **Issue 9:** CI infrastructure.
- Node, pnpm, and general dependency pinning.

## Scope

### In scope

#### Harness safety

- Introduce discriminated serial results.
- Add race-safe, settle-once process handling.
- Propagate `AbortSignal` through detection checkpoints, compilation, flashing, and serial reading.
- Translate aborts and process failures into explicit result states.
- Guarantee that each wrapper owns and terminates the process it creates.
- Preserve build artifacts when a child process may still be running.
- Validate flash artifacts before invoking esptool.
- Isolate cleanup and logging failures from the primary operation result.

#### Documentation correction

- Correct the QD001 ultrasonic pin map in `AGENTS.md`.
- Replace unsupported motor API examples with vendor-confirmed usage.
- Remove duplicate and machine-specific links.
- Pin executable ESP32 instructions to `esp32:esp32@2.0.18`.
- Isolate Arduino-ESP32 3.x material as incompatible reference or migration guidance.

### Out of scope

- Renaming or redesigning `robot_health`.
- Declaring the robot healthy or unhealthy.
- Selecting the correct USB device when multiple adapters exist.
- Adding backup or firmware restoration.
- Correcting Mecanum motion vectors.
- Adding GitHub Actions or other CI.
- Pinning Node, pnpm, or unrelated dependencies.

## Approach

The change has two work streams.

### 1. Harness safety

Implement:

- `TerminateChildResult`
- `ChildTerminationError`
- race-safe `waitForClose`
- non-throwing `terminateChild`
- controlled wrapper-level process state machines
- `SerialReadResult`
- `HealthCheckResult`
- cancellation checkpoints and abort translation
- artifact validation
- safe build-directory cleanup

The critical rule is:

> A wrapper must not resolve or reject until the child process it created has either emitted `close` or termination failure has been explicitly reported.

A failed child termination has priority over ordinary cancellation because it means the process may still be running.

### 2. Documentation correction

Use vendor sketches with full SHA-256 hashes as the primary evidence for the corrected pins and motor API. Derived wiki material may be used as supporting context, not as the primary source.

## Success Criteria

1. `pnpm run build` exits with code 0.
2. `pnpm run lint` exits with code 0.
3. All tests pass.
4. No pre-existing test is deleted without written justification.
5. The final test count is recorded and is at least the confirmed baseline plus all accepted new scenarios.
6. `readSerial` returns explicit `success`, `incomplete`, `timeout`, `error`, or `cancelled` results.
7. All child-process wrappers settle exactly once and remove abort listeners after completion.
8. `compileSketch`, `flashSketch`, and `readSerial` do not finish before their child process lifecycle is resolved.
9. A failed process termination is reported as an error, never hidden as an ordinary cancellation.
10. Build artifacts are preserved and their exact path is reported when process termination cannot be confirmed.
11. esptool is never called when any required binary is missing, empty, or not a regular file.
12. `protocol_complete` is used only to mean that the serial protocol completed; it must not be presented as proof of robot health.
13. `AGENTS.md` examples match vendor-confirmed pins and API usage.
14. Executable project instructions use `esp32:esp32@2.0.18`.
15. Any 3.x material is clearly labelled incompatible with the current project or presented only as migration guidance.

## Rollback Plan

All code changes are host-side.

- Revert the harness commit to restore the previous serial, compilation, flash, and health orchestration behavior.
- Revert the documentation commit to restore the previous documentation.
- No data migration is required.
- No firmware source is modified by this change.

Hardware-gated tests must still be run under controlled conditions because the affected host-side code can compile and flash firmware.

## Breaking Changes

Two internal breaking changes are accepted:

1. `readSerial` changes from `Promise<string[]>` to `Promise<SerialReadResult>`.
2. `runHealthCheck` changes from positional arguments to `RunHealthCheckOptions`.

All known consumers are internal to the harness and must be migrated in the same change. No backward-compatibility wrapper will be added.

## Operational Warning

This change improves transport and process safety, but it does not fix the firmware's unconditional `pass` message. User-facing output must therefore say that the protocol completed, not that the robot passed a diagnostic.
