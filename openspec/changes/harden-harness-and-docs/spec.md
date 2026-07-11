# Spec — harden-harness-and-docs

> SDD spec phase. Formal requirements contract (RFC 2119) for harness safety
> and documentation hardening. Sits between `proposal.md` (why) and `design.md`
> (how). Type contracts in `design.md` are normative; this spec references them.

## Purpose

Correct audit issues 3–6 and 8: unsafe cancellation propagation, ambiguous
serial failures, missing flash-artifact validation, contradicted hardware/API
docs, and Arduino-ESP32 3.x contamination. Introduces discriminated result
types, settle-once child-process lifecycle, and vendor-evidenced documentation.

## Requirements

### REQ-001: Child-process primitives are non-throwing and race-safe

`terminateChild` MUST NOT throw; it MUST return `TerminateChildResult` with
exactly one of `already_closed`, `terminated` (SIGTERM), `killed` (SIGKILL),
or `failed`. `waitForClose` MUST prevent the closed-between-check-and-listener
race by checking `exitCode`/`signalCode`, registering a one-shot `close`
listener, re-checking, then starting a timeout, and MUST clean up the listener
and timer on every terminal path. Both `proc.kill()` calls MUST be wrapped in
`try/catch`; a `false` return from `kill()` MUST NOT be treated as proof of
failure without re-checking closure. (Design AD1, AD2, AD3.)

- Given an already-closed process, when `terminateChild` runs, then it returns `{status:"already_closed"}` without calling `kill()`.
- Given SIGTERM closes the process within the grace period, when `terminateChild` runs, then it returns `{status:"terminated",signal:"SIGTERM"}`.
- Given SIGTERM is insufficient, when the grace period expires, then SIGKILL is sent and the result is `{status:"killed",signal:"SIGKILL"}` if closure follows.
- Given `close` fires between the check and listener registration, when `waitForClose` runs, then the re-check observes it and returns `true` without waiting on the timeout.
- Given `kill()` throws, when `terminateChild` runs, then the exception is caught and the lifecycle continues or returns `{status:"failed",error:...}`.

### REQ-002: Each wrapper owns its child process and settles exactly once

`compileSketch`, `flashSketch`, and `readSerial` MUST own the complete
lifecycle of the process they create. Each wrapper MUST install exactly one
abort listener, MUST NOT resolve or reject normally before `close`, MUST remove
the abort listener on every terminal path, and MUST settle exactly once.
`close`, `error`, and abort MUST share a single settle-once guard. No
unhandled rejection MAY originate from the abort listener. If abort has begun,
a `close` produced by termination MUST NOT be interpreted as successful
completion. (Design AD4, AD5.)

- Given abort fires, when the wrapper is mid-flight, then it calls `terminateChild(proc)` and rejects with `ChildTerminationError` if termination is unconfirmed, otherwise rejects with `AbortError`.
- Given abort and `close` race, when both occur, then exactly one outcome wins via the settle-once guard.
- Given normal completion, when the wrapper settles, then the abort listener is removed and no unhandled rejection remains.
- Given abort listener throws, when the throw occurs, then it is captured by the wrapper's controlling promise, not surfaced as an unhandled rejection.

### REQ-003: Child termination failure has priority over cancellation

A `ChildTerminationError` MUST be reported as `status:"error"` with
`code:"child_termination_unconfirmed"` and `processMayStillBeRunning:true`,
never as an ordinary `cancelled` result. A failed termination means the
process may still be running, so cleanup MUST be skipped and the build
directory path MUST be reported via `artifactsPreservedAt`. (Design AD6.)

- Given `ChildTerminationError` is caught, when the error boundary runs, then the result is `status:"error"`, `code:"child_termination_unconfirmed"`, `cleanupSkipped:true`, and `artifactsPreservedAt` equals the build dir.
- Given an abort signal is aborted but termination is confirmed, when the error boundary runs, then the result is `status:"cancelled"` (termination success does not escalate).
- Given both `ChildTerminationError` and an aborted signal, when prioritized, then `ChildTerminationError` wins and the result is `error`, not `cancelled`.

### REQ-004: `readSerial` returns a discriminated `SerialReadResult`

`readSerial` MUST return `Promise<SerialReadResult>` with exactly one of
`success`, `incomplete`, `timeout`, `error`, or `cancelled`. Terminal meanings:
`success` = stop predicate reached; `incomplete` = process closed with code 0
before the predicate; `timeout` = timeout selected before abort or closure;
`error` = spawn failure, non-zero exit, unexpected signal, pipe failure, or
unconfirmed child termination; `cancelled` = abort selected and termination
confirmed. (Design AD7. Breaking change — see REQ-019.)

- Given the stop predicate is reached, when `readSerial` resolves, then `status:"success"` with `data:string[]`.
- Given the process exits 0 before the predicate, when `readSerial` resolves, then `status:"incomplete"` with `exitCode:0`.
- Given a non-zero exit or spawn failure, when `readSerial` resolves, then `status:"error"` with `error`, `stderr?`, `exitCode?`, `signal?`.
- Given abort with confirmed termination, when `readSerial` resolves, then `status:"cancelled"` with `data`.
- Given abort with unconfirmed termination, when `readSerial` resolves, then `status:"error"` with `code:"child_termination_unconfirmed"` regardless of the previously selected state.

### REQ-005: Serial settlement is two-phase and termination-aware

`readSerial` MUST separate result selection from promise resolution via
`selectResult` then `finalize`. `finalize` MUST clear runtime listeners and
timers, call `terminateChild(proc)`, and resolve only after termination
handling finishes. Any termination failure MUST override `success`,
`incomplete`, `timeout`, or `cancelled`. (Design AD8.)

- Given `selectResult` is called twice, when the second call occurs, then it is a no-op (exactly one selection).
- Given termination returns `{status:"failed"}`, when `finalize` runs, then the resolved result is `status:"error"`, `code:"child_termination_unconfirmed"`, `processMayStillBeRunning:true`, even if the selected result was `success`.
- Given termination succeeds, when `finalize` runs, then the originally selected result is resolved unchanged.

### REQ-006: `runHealthCheck` uses `RunHealthCheckOptions` and returns `HealthCheckResult`

`runHealthCheck` MUST accept `RunHealthCheckOptions` (`skipFlash`, `signal?`,
`ctx?`) and return `HealthCheckResult` with exactly one of `protocol_complete`,
`incomplete`, `timeout`, `error`, or `cancelled`, each carrying
`HealthCheckContext` (`stage`, `detect?`, `flashed`). (Design AD9. Breaking
change — see REQ-020.)

- Given `skipFlash:false` and a successful end-to-end run, when `runHealthCheck` resolves, then `status:"protocol_complete"`, `stage:"complete"`, `flashed:true`.
- Given `skipFlash:true`, when `runHealthCheck` resolves, then no `mkdtemp`/compile/flash occurs, `flashed:false`, and the serial stage runs.
- Given detection failure, when `runHealthCheck` resolves, then `status:"error"`, `code:"operation_failed"`, `stage:"detect"`, `flashed:false`.

### REQ-007: `runHealthCheck` has a full error boundary with stage tracking

Detection, temp-dir creation, compilation, flash, serial read, and cleanup
MUST belong to one orchestration `try/catch/finally`. `stage` MUST be advanced
per the transition table (detect → compile → flash → serial → complete). The
`finally` block MUST call `safeRemoveBuildDir` when `cleanupAllowed`, or
`safeLog` the preserved path otherwise. Cleanup failure MUST NOT change the
main operation result. (Design AD10, AD12, AD14.)

- Given `mkdtemp` fails, when the error boundary runs, then `status:"error"`, `code:"operation_failed"`, `stage:"compile"`, `flashed:false`.
- Given `ChildTerminationError`, when the `finally` runs, then `cleanupAllowed` is `false`, the build dir is preserved, and a warning is logged with the exact path.
- Given `safeRemoveBuildDir` throws, when the `finally` completes, then the main result is unchanged and the failure is logged via `safeLog`.
- Given `safeLog`'s sink throws, when logging is attempted, then the exception is swallowed and the main result is unchanged.

### REQ-008: `skipFlash` short-circuits compile and flash

When `skipFlash` is `true`, `runHealthCheck` MUST NOT call `mkdtemp`,
`compileSketch`, or `flashSketch`; it MUST call `readSerial` and MUST keep
`flashed:false`. (Design AD11.)

- Given `skipFlash:true`, when orchestration runs, then `stage` goes `detect` → `serial` and `flashed` stays `false`.
- Given `skipFlash:false`, when orchestration runs, then `mkdtemp`, `compileSketch`, and `flashSketch` are all invoked.

### REQ-009: Result mapping is exhaustive and stage-aware

`mapSerialResult` MUST map `success` → `protocol_complete` with
`stage:"complete"` and a parsed `HealthReport`; `incomplete`, `timeout`,
`error`, and `cancelled` MUST carry their serial `data`/`partialData` and the
input `context` stage (not `complete`). Only `protocol_complete` receives
`stage:"complete"`. The default branch MUST use `assertNever`. (Design AD13.)

- Given `SerialReadResult.status:"success"`, when mapped, then `HealthCheckResult.status:"protocol_complete"`, `stage:"complete"`, `report:parseHealthLines(data)`.
- Given `SerialReadResult.status:"error"`, when mapped, then `error`, `code?`, `processMayStillBeRunning?`, `stderr?`, `exitCode?`, `signal?`, and `partialData` are forwarded and `stage` is the serial context.
- Given an unmapped status, when mapped, then `assertNever` raises at compile time.

### REQ-010: Flash artifacts are validated before esptool spawn

Before spawning esptool, `flashSketch` MUST validate four required artifacts —
bootloader, partition table, `boot_app0`, and application firmware. Each
artifact MUST exist, MUST be a regular file, and MUST have size greater than
zero. Any invalid artifact MUST raise an artifact-specific `EsptoolError`
before process creation, and esptool MUST NOT be spawned. (Design AD15.)

- Given all four artifacts are valid, when `flashSketch` runs, then esptool is spawned.
- Given any artifact is missing, not a regular file, or zero bytes, when validation runs, then `EsptoolError` is raised and no esptool process is created.
- Given validation passes but spawn later fails, when `flashSketch` runs, then the result is `status:"error"` (not an artifact error).

### REQ-011: Health semantics remain neutral

`protocol_complete` MUST mean only that the serial protocol reached its
expected completion marker. It MUST NOT be rendered as `healthy`, `passed`,
`all components working`, or `diagnosis successful`. The parser
`parseHealthLines` MUST remain protocol-only. Issue 1 (health semantics
redesign) is out of scope. (Design AD16.)

- Given `protocol_complete`, when rendered, then the label is `protocol_complete` (or equivalent neutral wording), never `healthy` or `passed`.
- Given `protocol_complete`, when `parseHealthLines` runs, then it returns a `HealthReport` describing protocol lines, not a health verdict.

### REQ-012: Ultrasonic pin map matches vendor sketch

`AGENTS.md` MUST document the QD001 ultrasonic pins as TRIG 13, ECHO 14,
evidenced by `myUltrasonic.Init(13,14)` in the vendor sketch
`3.1UltrasonicRanging.ino` (SHA-256 `69244807...`). Documentation MUST state
the API is confirmed by vendor sketches, not by direct library-source
verification. (Design hardware evidence.)

- Given `AGENTS.md` is inspected, when the ultrasonic section is read, then pins are TRIG 13 / ECHO 14 with the sketch hash cited.
- Given the vendor sketch, when hashed, then SHA-256 equals `692448072d35ef6f82c1db1a452b0819e448fa04256a6bcb0530cb486e9bca96`.

### REQ-013: Motor API matches vendor sketch

`AGENTS.md` MUST document the motor API as `ACB_SmartCar.Move(direction,
speed)` with directions such as `Forward`/`Backward`, evidenced by
`4.3Web_control_car.ino` (SHA-256 `ddd1b237...`). Unsupported motor API
examples MUST be replaced with vendor-confirmed usage. (Design hardware
evidence.)

- Given `AGENTS.md` is inspected, when the motor section is read, then the API is `ACB_SmartCar.Move(Forward, 255)` style with the sketch hash cited.
- Given the vendor sketch, when hashed, then SHA-256 equals `ddd1b237b983de342744c28eab711bfcc8c8caf0cbbd5fecac149ff66ff8456b`.

### REQ-014: Executable ESP32 instructions pin core 2.0.18

Executable project instructions MUST use core `esp32:esp32@2.0.18` (FQBN
`esp32:esp32:esp32`). Arduino-ESP32 3.x material MUST be clearly labelled
incompatible with the current project or presented only as migration guidance;
it MUST NOT appear in executable instructions. The `esp32-arduino-development`
skill MUST remove `arduino-cli upload` usage and isolate 3.x content. (Design
AD hardware evidence + file changes.)

- Given executable instructions, when a core is referenced, then it is `esp32:esp32@2.0.18`.
- Given 3.x material exists, when rendered, then it is labelled incompatible or marked as migration guidance only.
- Given the flash skill, when upload is described, then `arduino-cli upload` is absent (it forces 921600 baud and causes 0xE0).

### REQ-015: Duplicate and machine-specific links are removed

`AGENTS.md` MUST NOT contain duplicate links or machine-specific (absolute)
paths in examples. Link targets MUST be repo-relative or canonical. (Design
file changes.)

- Given `AGENTS.md` is inspected, when links are enumerated, then each link appears once and no link embeds a machine-specific absolute path.

### REQ-016: Build, lint, and test quality gate

`pnpm run build` MUST exit 0. `pnpm run lint` MUST exit 0. All tests MUST
pass. No pre-existing test MAY be deleted without written justification. The
final test count MUST be at least the confirmed baseline plus all accepted new
scenarios. (Proposal success criteria 1–5.)

- Given the change is applied, when `pnpm run build` runs, then exit code is 0.
- Given the change is applied, when `pnpm run lint` runs, then exit code is 0.
- Given the change is applied, when `pnpm test` runs, then all tests pass and the count is recorded and ≥ baseline + new scenarios.

### REQ-017: Wrapper lifecycle guarantees (success criteria 6–10)

`readSerial` MUST return explicit `success`/`incomplete`/`timeout`/`error`/
`cancelled` results. All child-process wrappers MUST settle exactly once and
remove abort listeners after completion. `compileSketch`, `flashSketch`, and
`readSerial` MUST NOT finish before their child-process lifecycle is resolved.
A failed termination MUST be reported as an error, never hidden as
cancellation. Build artifacts MUST be preserved and their exact path reported
when termination cannot be confirmed. (Proposal success criteria 6–10.)

- Given `readSerial` resolves, when the status is read, then it is one of the five explicit statuses.
- Given any wrapper, when it settles, then it has settled exactly once and removed its abort listener.
- Given termination is unconfirmed, when the result is produced, then `artifactsPreservedAt` equals the exact build-dir path.

### REQ-018: esptool and protocol guards (success criteria 11–15)

esptool MUST NOT be called when any required binary is missing, empty, or not
a regular file. `protocol_complete` MUST NOT be presented as proof of robot
health. `AGENTS.md` examples MUST match vendor-confirmed pins and API usage.
Executable project instructions MUST use `esp32:esp32@2.0.18`. Any 3.x
material MUST be labelled incompatible or migration-only. (Proposal success
criteria 11–15.)

- Given a missing/empty/non-regular artifact, when `flashSketch` is called, then esptool is not spawned.
- Given `protocol_complete`, when presented to a user, then it is not rendered as `healthy` or `passed`.
- Given `AGENTS.md`, when examples are read, then pins and motor API match the vendor sketches cited in REQ-012/REQ-013.

## Type Contracts (Normative)

The TypeScript signatures in `design.md` are normative. Implementations MUST
match these contracts exactly:

- `TerminateChildResult` — discriminated union: `already_closed | terminated | killed | failed` (Design §1).
- `ChildTerminationError` — `extends Error`, `processMayStillBeRunning = true`, carries `termination: TerminateChildResult` (Design §1).
- `terminateChild(proc, options?: {graceMs?, killMs?}): Promise<TerminateChildResult>` — non-throwing (Design §1).
- `waitForClose(proc, timeoutMs): Promise<boolean>` — race-safe (Design §2).
- `SerialReadResult` — 5-status discriminated union (Design §7).
- `RunHealthCheckOptions` — `{skipFlash: boolean; signal?: AbortSignal; ctx?: ExtensionContext; log?: (message: string) => void}` (Design §9). The `log?` field exists because `ExtensionContext` (from `@earendil-works/pi-coding-agent`) has no `.log` method; it defaults to `console.error` via `safeLog` and cleanup/logging failures MUST NOT change the primary result.
- `HealthStage` — `"detect" | "compile" | "flash" | "serial" | "complete"` (Design §9).
- `HealthCheckContext` — `{stage: HealthStage; detect?: DetectResult; flashed: boolean}` (Design §9).
- `HealthCheckResult` — 5-status union intersected with `HealthCheckContext` (Design §9).
- `mapSerialResult(result, context): HealthCheckResult` — exhaustive switch with `assertNever` default (Design §13).
- `safeLog(log, message): void` and `safeRemoveBuildDir(directory, log?): Promise<void>` — failure-isolated (Design §14).

## File Changes

Mirrors `design.md` file-changes table.

| File | Action | Description |
|------|--------|-------------|
| `harness/src/lib/child-process.ts` | Create | `waitForClose`, `terminateChild`, `TerminateChildResult`, `ChildTerminationError`, `safeLog` |
| `harness/src/lib/arduino-cli.ts` | Modify | Controlled settle-once lifecycle and abort handling |
| `harness/src/lib/esptool.ts` | Modify | Controlled lifecycle, termination errors, artifact validation |
| `harness/src/lib/serial.ts` | Modify | Discriminated results, two-phase finalize, stderr capture |
| `harness/src/tools/health.ts` | Modify | Full result boundary, cancellation priority, safe cleanup, mapping |
| `harness/src/lib/parser.ts` | No change | Remains protocol-only |
| `harness/tests/unit/child-process.test.ts` | Create | Lifecycle primitive tests |
| `harness/tests/unit/arduino-cli.test.ts` | Modify | Wrapper abort and race tests |
| `harness/tests/unit/esptool.test.ts` | Modify | Wrapper lifecycle and artifact tests |
| `harness/tests/unit/serial.test.ts` | Modify | Result, race, teardown tests |
| `harness/tests/unit/health.test.ts` | Modify | Error, cleanup, stage, mapping, and presentation tests |
| `AGENTS.md` | Modify | Pin map, motor API, duplicate and absolute links |
| `skills/esp32-arduino-development/SKILL.md` | Modify | Core pin, upload removal, 3.x isolation |

## Breaking Changes Accepted

Two internal breaking changes are accepted. All known consumers are internal
to the harness and MUST be migrated in the same change. No backward-
compatibility wrapper will be added.

1. `readSerial`: `Promise<string[]>` → `Promise<SerialReadResult>` (REQ-004).
2. `runHealthCheck`: positional arguments → `RunHealthCheckOptions` (REQ-006).

## Out of Scope

The following audit findings are deliberately excluded from this change and
MUST NOT be addressed here:

- **Issue 1:** `robot_health` semantics and unconditional firmware `pass` (separately redesigned).
- **Issue 2:** Safe device identification and destructive-flash confirmation.
- **Issue 7:** Mecanum vector correction (pending controlled hardware validation).
- **Issue 9:** CI infrastructure.
- Node, pnpm, and general dependency pinning.
- Renaming or redesigning `robot_health`; declaring the robot healthy/unhealthy; selecting the correct USB device when multiple adapters exist; adding backup or firmware restoration; adding GitHub Actions.

## Hardware Evidence

Both SHA-256 hashes below have been verified against the actual files on disk
(confirmed during spec generation). They are the primary evidence for
REQ-012 and REQ-013.

### Ultrasonic pins

```text
File:    Español/1.Tutoriales/Arduino (Alumno experimentado)/2.Procedimiento/3.1UltrasonicRanging/3.1UltrasonicRanging.ino
SHA-256: 692448072d35ef6f82c1db1a452b0819e448fa04256a6bcb0530cb486e9bca96
Evidence: myUltrasonic.Init(13,14);   // TRIG 13, ECHO 14
```

### Motor API

```text
File:    Español/1.Tutoriales/Arduino (Alumno experimentado)/2.Procedimiento/4.3Web_control_car/4.3Web_control_car.ino
SHA-256: ddd1b237b983de342744c28eab711bfcc8c8caf0cbbd5fecac149ff66ff8456b
Evidence: ACB_SmartCar.Move(Forward, 255); ACB_SmartCar.Move(Backward, 255);
```

### Arduino core

```text
Core: esp32:esp32@2.0.18   FQBN: esp32:esp32:esp32
```

## Operational Warning

This change improves transport and process safety but does NOT fix the
firmware's unconditional `pass` message. User-facing output MUST say the
protocol completed, not that the robot passed a diagnostic. (See REQ-011.)
