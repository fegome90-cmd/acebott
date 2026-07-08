# Design — harden-harness-and-docs

## Technical Approach

This change has two work streams.

The harness work introduces:

- shared child-process lifecycle primitives;
- wrapper-owned process termination;
- explicit result types;
- settle-once concurrency;
- abort translation;
- full `runHealthCheck` error discrimination;
- safe cleanup with failure isolation;
- flash artifact validation.

The documentation work corrects hardware and API examples using vendor sketches with complete SHA-256 hashes.

## Architecture Decisions

### 1. Shared child-process primitives

Create `harness/src/lib/child-process.ts`.

```ts
export type TerminateChildResult =
  | { status: "already_closed" }
  | { status: "terminated"; signal: "SIGTERM" }
  | { status: "killed"; signal: "SIGKILL" }
  | { status: "failed"; error: string };

export class ChildTerminationError extends Error {
  readonly processMayStillBeRunning = true;

  constructor(
    message: string,
    readonly termination: TerminateChildResult,
  ) {
    super(message);
    this.name = "ChildTerminationError";
  }
}
```

`terminateChild` must never throw. It always returns `TerminateChildResult`.

```ts
export async function terminateChild(
  proc: ChildProcess,
  options?: {
    graceMs?: number;
    killMs?: number;
  },
): Promise<TerminateChildResult>;
```

### 2. Race-safe `waitForClose`

`waitForClose` must prevent the "closed between check and listener registration" race.

Required behavior:

1. Check `exitCode` and `signalCode`.
2. Register a one-shot `close` listener.
3. Check `exitCode` and `signalCode` again.
4. Start a timeout only after the listener is registered.
5. Remove the listener and clear the timer on every terminal path.

Conceptual contract:

```ts
async function waitForClose(
  proc: ChildProcess,
  timeoutMs: number,
): Promise<boolean>;
```

`true` means closure was confirmed. `false` means the timeout expired without a confirmed `close`.

### 3. `terminateChild` lifecycle

```text
already closed
  → already_closed

send SIGTERM
  → wait grace period
  → if closed: terminated

send SIGKILL
  → wait kill period
  → if closed: killed

re-check exitCode/signalCode
  → if closed between operations: terminated or killed

otherwise
  → failed
```

Both `proc.kill()` calls must be wrapped in `try/catch`.

A `false` return value from `kill()` is not by itself proof of failure. The helper must re-check closure before returning `failed`.

### 4. Each wrapper owns its child process

The function that creates a process owns its complete lifecycle.

#### `compileSketch`

- creates Arduino CLI;
- installs one abort listener;
- on abort, calls `terminateChild(proc)`;
- rejects with `ChildTerminationError` if termination is unconfirmed;
- otherwise rejects with an `AbortError`;
- does not resolve or reject normally until `close`;
- removes the abort listener on every terminal path;
- settles exactly once.

#### `flashSketch`

The same contract applies to esptool.

#### `readSerial`

- creates the Python process;
- selects a terminal serial result exactly once;
- clears runtime listeners and timers;
- calls `terminateChild(proc)`;
- resolves only after termination handling finishes;
- converts any termination failure into `status: "error"` regardless of the previously selected serial state.

### 5. Wrapper abort callbacks do not throw independently

An asynchronous abort listener must not throw outside the wrapper's controlling promise.

Each wrapper uses one settlement function:

```ts
type Settlement<T> =
  | { type: "resolve"; value: T }
  | { type: "reject"; error: unknown };

function finish<T>(settlement: Settlement<T>): void;
```

The abort listener starts an observed async task and reports its outcome through `finish()`.

Required rules:

- `close`, `error`, and abort share the same settle-once guard.
- No unhandled rejection may originate from the abort listener.
- An abort listener is removed after normal completion.
- If abort and close race, exactly one outcome wins.
- If abort has begun, a `close` produced by termination must not be interpreted as successful completion.

### 6. Child termination failure has priority

`ChildTerminationError` has priority over ordinary cancellation.

```ts
catch (error) {
  if (error instanceof ChildTerminationError) {
    cleanupAllowed = false;

    return {
      status: "error",
      code: "child_termination_unconfirmed",
      error: error.message,
      processMayStillBeRunning: true,
      cleanupSkipped: buildDir !== undefined,
      artifactsPreservedAt: buildDir,
      partialData: [],
      stage,
      detect,
      flashed,
    };
  }

  if (options.signal?.aborted || isAbortError(error)) {
    return {
      status: "cancelled",
      partialData: [],
      stage,
      detect,
      flashed,
    };
  }

  return normalErrorResult(...);
}
```

A failed termination must never be returned as an ordinary `cancelled` result.

### 7. Serial result contract

```ts
export type SerialReadResult =
  | {
      status: "success";
      data: string[];
    }
  | {
      status: "incomplete";
      data: string[];
      exitCode: 0;
    }
  | {
      status: "timeout";
      data: string[];
    }
  | {
      status: "error";
      data: string[];
      error: string;
      code?: "child_termination_unconfirmed" | "process_failed";
      processMayStillBeRunning?: boolean;
      stderr?: string;
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
    }
  | {
      status: "cancelled";
      data: string[];
    };
```

Terminal meanings:

- `success`: stop predicate was reached.
- `incomplete`: process closed with code 0 before the stop predicate.
- `timeout`: timeout selected before abort or process closure.
- `error`: spawn failure, non-zero exit, unexpected signal, pipe failure, or unconfirmed child termination.
- `cancelled`: abort was selected and child termination was confirmed.

### 8. Two-phase serial settlement

`readSerial` separates result selection from promise resolution.

```ts
function selectResult(result: SerialReadResult): void {
  if (selected) return;
  selected = true;

  const selectedResult = signal?.aborted
    ? { status: "cancelled", data: [...data] } as const
    : result;

  void finalize(selectedResult);
}

async function finalize(result: SerialReadResult): Promise<void> {
  clearRuntimeListenersAndTimer();

  const termination = await terminateChild(proc);

  if (termination.status === "failed") {
    resolve({
      status: "error",
      code: "child_termination_unconfirmed",
      processMayStillBeRunning: true,
      data: result.data,
      error: "Serial child process termination could not be confirmed",
    });
    return;
  }

  resolve(result);
}
```

Any termination failure overrides `success`, `incomplete`, `timeout`, or `cancelled`.

### 9. Health-check options and result types

```ts
export interface RunHealthCheckOptions {
  skipFlash: boolean;
  signal?: AbortSignal;
  ctx?: ExtensionContext;
  /**
   * Optional diagnostic sink used by safe cleanup. Defaults to `console.error`
   * via `safeLog`. Required because `ExtensionContext` from
   * `@earendil-works/pi-coding-agent` has no `.log` method; cleanup/logging
   * failures MUST NOT change the primary result (AD14).
   */
  log?: (message: string) => void;
}

export type HealthStage =
  | "detect"
  | "compile"
  | "flash"
  | "serial"
  | "complete";

export interface HealthCheckContext {
  stage: HealthStage;
  detect?: DetectResult;
  flashed: boolean;
}
```

```ts
export type HealthCheckResult =
  | (HealthCheckContext & {
      status: "protocol_complete";
      report: HealthReport;
    })
  | (HealthCheckContext & {
      status: "incomplete";
      partialData: string[];
      exitCode: 0;
    })
  | (HealthCheckContext & {
      status: "timeout";
      partialData: string[];
    })
  | (HealthCheckContext & {
      status: "error";
      error: string;
      code?: "child_termination_unconfirmed" | "operation_failed";
      processMayStillBeRunning?: boolean;
      cleanupSkipped?: boolean;
      artifactsPreservedAt?: string;
      stderr?: string;
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
      partialData: string[];
    })
  | (HealthCheckContext & {
      status: "cancelled";
      partialData: string[];
    });
```

### 10. Full `runHealthCheck` error boundary

Detection, temporary directory creation, compilation, flash, serial read, and cleanup all belong to the same orchestration contract.

```ts
export async function runHealthCheck(
  options: RunHealthCheckOptions,
): Promise<HealthCheckResult> {
  let stage: HealthStage = "detect";
  let detect: DetectResult | undefined;
  let flashed = false;
  let buildDir: string | undefined;
  let cleanupAllowed = true;

  try {
    assertNotAborted(options.signal);

    detect = await detectDevice();
    assertNotAborted(options.signal);

    if (!options.skipFlash) {
      stage = "compile";
      buildDir = await mkdtemp(...);

      await compileSketch({
        buildDir,
        signal: options.signal,
        ...,
      });
      assertNotAborted(options.signal);

      stage = "flash";
      await flashSketch({
        buildDir,
        signal: options.signal,
        ...,
      });

      flashed = true;
      assertNotAborted(options.signal);
    }

    stage = "serial";

    const serialResult = await readSerial({
      signal: options.signal,
      ...,
    });

    return mapSerialResult(serialResult, {
      stage: "serial",
      detect,
      flashed,
    });
  } catch (error) {
    if (error instanceof ChildTerminationError) {
      cleanupAllowed = false;

      return {
        status: "error",
        code: "child_termination_unconfirmed",
        error: error.message,
        processMayStillBeRunning: true,
        cleanupSkipped: buildDir !== undefined,
        artifactsPreservedAt: buildDir,
        partialData: [],
        stage,
        detect,
        flashed,
      };
    }

    if (options.signal?.aborted || isAbortError(error)) {
      return {
        status: "cancelled",
        partialData: [],
        stage,
        detect,
        flashed,
      };
    }

    return {
      status: "error",
      code: "operation_failed",
      error: formatError(error),
      stderr: extractStderr(error),
      exitCode: extractExitCode(error),
      signal: extractSignalCode(error),
      partialData: [],
      stage,
      detect,
      flashed,
    };
  } finally {
    if (buildDir !== undefined) {
      if (cleanupAllowed) {
        await safeRemoveBuildDir(buildDir, options.log);
      } else {
        safeLog(
          options.log,
          `Build directory preserved because child-process termination was not confirmed: ${buildDir}`,
        );
      }
    }
  }
}
```

### 11. `skipFlash` semantics

When `skipFlash` is `true`:

- do not call `mkdtemp`;
- do not call `compileSketch`;
- do not call `flashSketch`;
- call `readSerial`;
- keep `flashed: false`.

### 12. Stage and flash-state transitions

| Operation                     | Stage before call |     `flashed` |
| ----------------------------- | ----------------- | ------------: |
| Detection                     | `detect`          |       `false` |
| Temporary directory / compile | `compile`         |       `false` |
| esptool running               | `flash`           |       `false` |
| esptool closed successfully   | `flash`           |        `true` |
| Serial read                   | `serial`          | current value |
| Protocol success mapping      | `complete`        | current value |

Only `protocol_complete` receives `stage: "complete"`.

### 13. Result mapping

```ts
export function mapSerialResult(
  result: SerialReadResult,
  context: HealthCheckContext,
): HealthCheckResult {
  switch (result.status) {
    case "success":
      return {
        status: "protocol_complete",
        report: parseHealthLines(result.data),
        ...context,
        stage: "complete",
      };

    case "incomplete":
      return {
        status: "incomplete",
        partialData: result.data,
        exitCode: 0,
        ...context,
      };

    case "timeout":
      return {
        status: "timeout",
        partialData: result.data,
        ...context,
      };

    case "error":
      return {
        status: "error",
        error: result.error,
        code: result.code,
        processMayStillBeRunning: result.processMayStillBeRunning,
        stderr: result.stderr,
        exitCode: result.exitCode,
        signal: result.signal,
        partialData: result.data,
        ...context,
      };

    case "cancelled":
      return {
        status: "cancelled",
        partialData: result.data,
        ...context,
      };

    default:
      return assertNever(result);
  }
}
```

### 14. Safe cleanup and logging

```ts
export function safeLog(
  log: ((message: string) => void) | undefined,
  message: string,
): void {
  try {
    (log ?? console.error)(message);
  } catch {
    // Diagnostics must never replace the main result.
  }
}
```

```ts
async function safeRemoveBuildDir(
  directory: string,
  log?: (message: string) => void,
): Promise<void> {
  try {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  } catch (error) {
    safeLog(
      log,
      `Failed to remove build directory ${directory}: ${formatError(error)}`,
    );
  }
}
```

Cleanup failure does not change the main operation result.

### 15. Flash artifact validation

Before spawning esptool, validate all four required artifacts:

- bootloader;
- partition table;
- `boot_app0`;
- application firmware.

Each artifact must:

- exist;
- be a regular file;
- have size greater than zero.

Any invalid artifact raises an artifact-specific `EsptoolError` before process creation.

### 16. Neutral health semantics

`protocol_complete` means only:

> The serial protocol reached its expected completion marker.

It must not be rendered as:

- healthy;
- passed;
- all components working;
- diagnosis successful.

The parser remains:

```ts
parseHealthLines(lines: string[]): HealthReport;
```

Issue 1 will separately redesign the health semantics.

## File Changes

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

## Testing Strategy

### Child-process primitives

Test:

- already-closed process;
- SIGTERM closure;
- escalation to SIGKILL;
- close between checks and listener registration;
- `kill()` returns false but closure is subsequently observed;
- SIGTERM throws;
- SIGKILL throws;
- failure after SIGKILL timeout;
- listeners and timers are cleaned.

### Compile and flash wrappers

For each wrapper:

- abort sends SIGTERM;
- failed SIGTERM escalates to SIGKILL;
- termination failure rejects with `ChildTerminationError`;
- wrapper does not settle before `close`;
- abort plus close settles once;
- abort plus process error settles once;
- abort listener failure is propagated through the wrapper promise;
- no unhandled rejection;
- abort listener removed after normal completion.

### Serial

Test:

- stop predicate success;
- exit 0 without marker;
- non-zero exit with stderr;
- spawn failure;
- timeout with partial data;
- abort before start;
- ordered abort/timeout races;
- stop/close race;
- listener and timer cleanup;
- termination failure overrides success;
- termination failure overrides timeout;
- termination failure overrides cancellation;
- exactly one final resolution.

### Health orchestration

Test:

- detection failure;
- abort before detection;
- abort observed after detection;
- `mkdtemp` failure;
- `skipFlash` behavior;
- cancellation checkpoints;
- `ChildTerminationError` priority over cancelled signal;
- exact preserved artifact path;
- cleanup warning;
- cleanup failure isolation;
- stage transitions;
- `flashed` transitions;
- all result mappings;
- `protocol_complete` presentation remains neutral.

### Artifact validation

Test each invalid artifact condition and verify esptool is not spawned.

## Hardware Evidence

### Ultrasonic pins

```text
File:
Español/1.Tutoriales/Arduino (Alumno experimentado)/2.Procedimiento/3.1UltrasonicRanging/3.1UltrasonicRanging.ino

SHA-256:
692448072d35ef6f82c1db1a452b0819e448fa04256a6bcb0530cb486e9bca96

Evidence:
myUltrasonic.Init(13,14);
```

### Motor API

```text
File:
Español/1.Tutoriales/Arduino (Alumno experimentado)/2.Procedimiento/4.3Web_control_car/4.3Web_control_car.ino

SHA-256:
ddd1b237b983de342744c28eab711bfcc8c8caf0cbbd5fecac149ff66ff8456b

Evidence:
ACB_SmartCar.Move(Forward, 255);
ACB_SmartCar.Move(Backward, 255);
```

The wording in project documentation must say that the API is confirmed by vendor sketches. It must not claim direct verification against unavailable library source.

### Arduino core

```text
Core:
esp32:esp32@2.0.18

FQBN:
esp32:esp32:esp32
```

## Migration

Internal migration only:

1. Update all `readSerial` callers to handle `SerialReadResult`.
2. Update all `runHealthCheck` callers to use `RunHealthCheckOptions`.
3. Update compile and flash callers for the new abort and termination-error behavior.
4. Export new public internal types through `index.ts` where required.
