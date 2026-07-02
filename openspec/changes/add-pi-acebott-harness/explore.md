# Explore — pi-acebott-harness

> SDD explore phase. Investigates feasibility, constraints, and design
> space before committing to a change proposal.

## Context

The Acebott QD001 development work currently depends on a text-only skill
(`acebott-esp32-flash`) and manual bash invocations of `arduino-cli`,
`esptool`, and `pyserial`. Every session must reconstruct context or
hope the skill loads. The agent is a generalist pretending to be a
hardware expert — it has no native tools for detecting the robot,
validating firmware, reading sensors, or confirming board health.

This change creates a **domain harness** (`pi-acebott-harness`) that
gives Pi native TypeScript tools for the Acebott QD001, following the
same pattern as `gentle-ai` (dev workflow harness) and
`tmux-fork-orchestrator` (multi-agent harness).

## Goals of Explore

- Confirm the Pi extension API surface needed
- Identify the package import name and version constraints
- Map the first iteration of tools (minimum viable harness)
- Identify hardware-test firmware requirements
- Surface risks and open questions

## Findings

### 1. Pi Extension API (confirmed)

- **Package**: `@earendil-works/pi-coding-agent` (NOT `@mariozechner/`
  as older skill docs say — the skill is outdated, the real installed
  package is `@earendil-works/pi-coding-agent@0.80.3`)
- **Registration**: `pi.registerTool({ name, label, description, parameters, execute })`
- **Schema**: `@sinclair/typebox` `Type.Object(...)` for params
- **StringEnum**: from `@earendil-works/pi-ai` (NOT `@mariozechner/pi-ai`)
- **Lifecycle**: `session_start` for init, `session_shutdown` for cleanup
  (the ONLY cleanup hook)
- **Context**: `ctx.cwd`, `ctx.ui.notify`, `ctx.ui.confirm` for user prompts
- **Error handling**: tools return `{ content: [{type:"text", text:"Error: ..."}] }`,
  NEVER throw
- **Cancellation**: `signal: AbortSignal` param in execute

### 2. Extension Discovery

Extensions are auto-discovered from:

- `~/.pi/agent/extensions/*.ts` (global)
- `~/.pi/agent/extensions/*/index.ts` (package)
- `.pi/extensions/*.ts` (project-local)

For a monorepo harness living inside `acebott/`, we have two install
options:

- **Symlink**: `~/.pi/agent/extensions/acebott-harness` → `acebott/harness/`
- **Build + copy**: build TS, copy to extensions dir

Symlink is cleaner for development (hot reload via `/reload`).

### 3. First-Iteration Tools (minimum viable)

Two tools prove the harness concept end-to-end:

#### `robot_detect`

Detects the connected robot and environment state.

Returns:

- Port path (`/dev/cu.usbserial-*`)
- USB chip identification (CH340 vendor/product ID via `system_profiler`)
- Whether ACECode is running (`pgrep -f ACECode`)
- Whether the port is free (`lsof`)
- Currently flashed firmware (best-effort, via serial probe)

No hardware side effects — read-only detection.

#### `robot_health`

Runs a full hardware self-test by flashing a test sketch and reading
the serial output.

Steps:

1. Call `robot_detect` internally to confirm robot present + port free
2. Block if ACECode is running (offer to kill via `ctx.ui.confirm`)
3. Compile `health_check.ino` (bundled firmware)
4. Flash via esptool bundled @ 115200 (guardrailed)
5. Read serial output, parse structured report
6. Return parsed result: LEDs OK, motors OK, ultrasonic distance,
   tracking values, IR code (if any)

### 4. Firmware: `health_check.ino`

A purpose-built test sketch that:

- Blinks both LEDs (pins 12, 2) — visual confirmation
- Beeps the buzzer (pin 33)
- Moves all 4 motors briefly (forward 1s, stop)
- Reads ultrasonic sensor (pins 13/14) → prints distance
- Reads all 3 tracking sensors (pins 35/36/39) → prints values
- Listens for IR (pin 4) → prints any received code
- Outputs all results as parseable JSON-lines over serial

Output format (one JSON per line):

```
{"t":"leds","left":"ok","right":"ok"}
{"t":"buzzer","status":"ok"}
{"t":"motors","fl":"ok","fr":"ok","bl":"ok","br":"ok"}
{"t":"ultrasonic","distance_cm":45}
{"t":"tracking","left":1200,"middle":800,"right":2100}
{"t":"ir","code":"none"}
{"t":"health","result":"pass"}
```

### 5. Library Wrappers

The harness needs TypeScript wrappers around the system tools:

- `lib/esptool.ts` — invoke the bundled esptool at known path
  (`/Applications/ACECode.app/Contents/extraFiles-mac/compile/burner/esptool`)
  with forced `--baud 115200`, proper offsets, signal cancellation
- `lib/serial.ts` — read serial output via `uv run --with pyserial`
  with timeout and line buffering
- `lib/arduino-cli.ts` — compile sketches with correct FQBN
  (`esp32:esp32:esp32`) and build-path
- `lib/constants.ts` — FQBN, baud rate, pin map, esptool path, firmware
  offsets, AP credentials

### 6. Testing Strategy

**vitest** for harness tests (the TypeScript code). Two layers:

- **Unit tests** (mocked): test tool registration, param validation,
  output parsing, error paths. Mock `child_process` and serial.
- **Integration tests** (real hardware, opt-in via env var):
  `ACEBOTT_HW=1 vitest test/integration` — actually detect/flash/test
  against the real robot. Skipped by default.

The firmware `health_check.ino` itself is validated by the integration
tests (it's the hardware-validation gate from our adapted TDD).

### 7. Package Structure

```
acebott/
└── harness/
    ├── package.json              ← "@acebott/harness", pnpm
    ├── tsconfig.json
    ├── README.md
    ├── src/
    │   ├── index.ts              ← factory: registers all tools
    │   ├── tools/
    │   │   ├── detect.ts         ← robot_detect
    │   │   └── health.ts         ← robot_health
    │   └── lib/
    │       ├── constants.ts      ← FQBN, baud, pins, paths
    │       ├── esptool.ts        ← flash wrapper
    │       ├── serial.ts         ← monitor wrapper
    │       ├── arduino-cli.ts    ← compile wrapper
    │       └── usb.ts            ← port/chip detection
    ├── firmware/
    │   └── health_check/
    │       └── health_check.ino  ← self-test sketch
    ├── skill/
    │   └── SKILL.md              ← domain skill (when to use tools)
    └── tests/
        ├── unit/
        │   ├── detect.test.ts
        │   ├── health.test.ts
        │   └── parsers.test.ts
        └── integration/
            └── hardware.test.ts   ← opt-in, real robot
```

### 8. Installation (local, no publish)

Per user decision: NO npm publish until fully tested. Local install via
symlink:

```bash
ln -s ~/Developer/acebott/harness ~/.pi/agent/extensions/acebott-harness
```

Hot reload during dev via Pi's `/reload` command.

## Constraints

- **No npm publish** in this iteration (security decision)
- **pnpm** as package manager (not npm — security decision)
- **macOS only** for now (esptool bundled path, `system_profiler`,
  `/dev/cu.usbserial-*` conventions)
- **QD001 only** (no QD010, QE001 variants yet)
- **Arduino C++ only** (no MicroPython support yet)

## Risks

| Risk | Mitigation |
| --- | --- |
| Import name mismatch (`@mariozechner/` vs `@earendil-works/`) | Verified: real package is `@earendil-works/pi-coding-agent` |
| Bundled esptool path varies across ACECode versions | Make path configurable, default to known location, detect on first run |
| Serial reading hangs forever | Hard timeout in `lib/serial.ts`, respects `signal.aborted` |
| Flashing bricks board if interrupted | Guardrail: refuse to flash if ACECode running, confirm with user |
| Hardware integration tests flaky | Mark as opt-in, default to mocked unit tests |

## Open Questions

1. **Skill placement**: should `skill/SKILL.md` live inside the harness
   package, or stay at the user level (`~/.pi/agent/skills/`)?
   Recommendation: inside harness, symlinked.
2. **Config file**: should harness read `acebott.config.json` for
   port overrides, or auto-detect every time? Recommendation: auto-detect
   first, add config later if needed.

## Recommendation

Proceed to **proposal** phase with scope: 2 tools (`robot_detect`,
`robot_health`), 1 firmware (`health_check.ino`), lib wrappers, unit
tests. Defer `robot_flash`, `robot_monitor`, `robot_sensors`,
`robot_move`, `robot_skills` to subsequent changes.
