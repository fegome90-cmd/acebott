# Proposal — pi-acebott-harness

> SDD proposal phase. Defines intent, scope, and approach for the change.

## Change

`add-pi-acebott-harness` — Create a Pi domain harness that gives the
agent native TypeScript tools for the Acebott QD001 robot, transforming
it from a generalist reading documentation into a hardware expert with
first-class capabilities.

## Motivation

Today the agent works on the Acebott QD001 by reading a text skill
and executing bash commands manually. This has three problems:

1. **No expertise**: the agent must reconstruct context every session
   and has no native capability to detect hardware, read sensors, or
   validate board health.
2. **No guardrails**: nothing prevents `arduino-cli upload` (broken,
   forces 921600 baud) or flashing while ACECode holds the port.
3. **No observability**: serial output is read as raw text; there is no
   structured way to query "is the robot healthy?" or "what do the
   sensors see right now?".

A domain harness — following the pattern of `gentle-ai` (dev workflow)
and `tmux-fork-orchestrator` (multi-agent) — solves all three by
registering native Pi tools that encapsulate expertise, enforce
guardrails, and return structured results.

## Scope

### In scope (this change)

- `harness/` subdirectory inside `acebott/` (monorepo, not a separate repo)
- `package.json` managed by **pnpm** (not npm — security decision)
- Pi extension TypeScript package: `src/index.ts` factory + tools + libs
- **2 native tools**:
  - `robot_detect` — detect robot, port, chip, ACECode state (read-only)
  - `robot_health` — flash self-test sketch, parse structured health report
- **1 firmware**: `firmware/health_check/health_check.ino` — tests LEDs,
  buzzer, motors, ultrasonic, tracking, IR; outputs JSON-lines over serial
- **4 lib wrappers**: `esptool.ts`, `serial.ts`, `arduino-cli.ts`, `usb.ts`
- **1 skill**: `skill/SKILL.md` — when to use each tool
- **Unit tests** (vitest, mocked): tool registration, parsing, error paths
- **Integration test scaffold** (opt-in via `ACEBOTT_HW=1`, real hardware)
- **Local install via symlink** (NO npm publish in this change)

### Out of scope (future changes)

- `robot_flash`, `robot_monitor`, `robot_sensors`, `robot_move`,
  `robot_skills` tools (iterative additions)
- npm/pnpm registry publication (deferred until tested against hardware)
- Windows/Linux support (macOS only for now)
- QD010, QE001, or other model variants (QD001 only)
- MicroPython support (Arduino C++ only)
- Config file for port/path overrides (auto-detect first)

## Approach

### Architecture

The harness is a standard Pi extension package with three layers:

```
┌─────────────────────────────────────────────────┐
│  Pi Agent (LLM)                                 │
│     calls robot_detect, robot_health as tools   │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  harness/src/index.ts (extension factory)       │
│     registers tools via pi.registerTool()       │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  harness/src/tools/                              │
│     detect.ts, health.ts                        │
│     (domain logic, validation, guardrails)      │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  harness/src/lib/                                │
│     esptool.ts, serial.ts, arduino-cli.ts, usb  │
│     (system wrappers, no domain logic)          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  System: arduino-cli, esptool bundled, pyserial │
└─────────────────────────────────────────────────┘
```

### Tool contracts

#### `robot_detect` (read-only)

Parameters: none (auto-detect) or `port` override.

Returns structured JSON:

```json
{
  "connected": true,
  "port": "/dev/cu.usbserial-110",
  "chip": { "vendor": "WCH", "productId": "0x7523", "vendorId": "0x1A86" },
  "acecodeRunning": false,
  "portBusy": false,
  "firmwareHint": "unknown"
}
```

#### `robot_health`

Parameters: optional `skipFlash` (use if firmware already known good).

Steps:

1. Detect robot (call detect logic)
2. If ACECode running → ask user to kill via `ctx.ui.confirm`
3. Compile + flash `health_check.ino` (guardrailed, 115200 baud)
4. Read serial for 10s, parse JSON-lines
5. Return structured health report

Returns:

```json
{
  "leds": { "left": "ok", "right": "ok" },
  "buzzer": "ok",
  "motors": { "fl": "ok", "fr": "ok", "bl": "ok", "br": "ok" },
  "ultrasonic": { "distance_cm": 45 },
  "tracking": { "left": 1200, "middle": 800, "right": 2100 },
  "ir": { "code": "none" },
  "result": "pass"
}
```

### Guardrails baked in

- Refuse flash if ACECode process is alive (offer to kill interactively)
- Force `--baud 115200` (never 921600)
- Use esptool bundled path only (never `arduino-cli upload`)
- Hard serial timeout (never hangs forever)
- Respect `signal.aborted` for cancellation

## Rollback Plan

If the harness causes issues:

- Remove the symlink: `rm ~/.pi/agent/extensions/acebott-harness`
- Pi restarts without the tools — no side effects on existing setup
- The `acebott-esp32-flash` skill remains independent and unaffected

The harness is **additive** — it never modifies existing Pi behavior,
only adds new tools.

## Success Criteria

1. `pi.registerTool` succeeds for both tools (visible in `/tools`)
2. `robot_detect` returns correct port/chip against real QD001
3. `robot_health` flashes `health_check.ino` and returns parsed report
4. All unit tests pass (`pnpm test`)
5. Integration test passes against real hardware (`ACEBOTT_HW=1 pnpm test`)
6. No regressions in existing Pi behavior

## Next Steps

Proceed to **spec** phase to define formal requirements and scenarios
for each tool.
