# Tasks — pi-acebott-harness

> SDD tasks phase. Implementation breakdown.
> Phases ordered by dependency. Check off `- [ ]` as completed.

## Phase 1: Scaffold

- [ ] 1.1 Create `harness/` directory structure (src/tools, src/lib,
      firmware, skill, tests/unit, tests/integration)
- [ ] 1.2 Write `package.json` with pnpm, vitest, typebox deps
      (`@earendil-works/pi-coding-agent`, `@sinclair/typebox`,
      `@earendil-works/pi-ai`, `vitest`, `typescript`)
- [ ] 1.3 Write `tsconfig.json` (strict, ESM, target ES2022)
- [ ] 1.4 Write `vitest.config.ts` (unit dir default, integration opt-in
      via `ACEBOTT_HW` env)
- [ ] 1.5 Write `.gitignore` (node_modules, dist, build artifacts)
- [ ] 1.6 Run `pnpm install` and confirm deps resolve
- [ ] 1.7 Run `pnpm build` (tsc --noEmit) and confirm 0 errors

## Phase 2: Constants and Libs

- [ ] 2.1 Write `src/lib/constants.ts` (FQBN, BAUD, ESPTOOL_PATH,
      FLASH_OFFSETS, CHIP, PINS, AP, SERIAL_TIMEOUT_MS) per design
- [ ] 2.2 Write `src/lib/usb.ts` — `detectChip()` using ioreg primary,
      system_profiler fallback (OQ-1)
- [ ] 2.3 Write `src/lib/serial.ts` — `readSerial()` with poll-for-line
      and timeout (OQ-2)
- [ ] 2.4 Write `src/lib/arduino-cli.ts` — `compileSketch()` with FQBN
      and build-path
- [ ] 2.5 Write `src/lib/esptool.ts` — `flashSketch()` with hardcoded
      baud 115200 and offsets (ADR-005), signal support
- [ ] 2.6 Add esptool path existence check in detect flow (RISK-04
      mitigation) — return clear error if path missing

## Phase 3: Firmware

- [ ] 3.1 Write `firmware/health_check/health_check.ino` with:
      - ACB_SmartCar_V2.Init() (no movement — OQ-3)
      - LED blink test (pins 12, 2)
      - Buzzer beep test (pin 33)
      - Ultrasonic read (pins 13/14) → JSON line
      - Tracking read (pins 35/36/39) → JSON line
      - IR read (pin 4) → JSON line
      - Terminal `{"t":"health","result":"pass"}` line
- [ ] 3.2 Verify firmware compiles with `arduino-cli compile --fqbn
      esp32:esp32:esp32`

## Phase 4: Tools

- [ ] 4.1 Write `src/tools/detect.ts` — `robot_detect` tool:
      - Detect port via `/dev/cu.usbserial-*` glob
      - Detect chip via lib/usb
      - Check ACECode via `pgrep -f ACECode`
      - Check port busy via `lsof`
      - Return DetectResult per design contract
- [ ] 4.2 Write `src/tools/health.ts` — `robot_health` tool:
      - Call detect logic
      - If ACECode running → ctx.ui.confirm to kill
      - If skipFlash false → compile + flash health_check.ino
      - Read serial via lib/serial
      - Parse JSON lines into HealthReport
      - Return report
- [ ] 4.3 Write JSON-lines parser (inline in health.ts or separate
      `src/lib/parser.ts`) — skip malformed, detect terminal "health"
      line
- [ ] 4.4 Write `src/index.ts` extension factory — register both tools
      via `pi.registerTool`, import types from
      `@earendil-works/pi-coding-agent`

## Phase 5: Skill

- [ ] 5.1 Write `skill/SKILL.md` — domain skill:
      - When to use robot_detect vs robot_health
      - Guardrails summary (baud, ACECode, no arduino-cli upload)
      - Reference to acebott-esp32-flash skill for manual flash
      - Pin map quick reference

## Phase 6: Unit Tests (mocked)

- [ ] 6.1 Write `tests/unit/detect.test.ts`:
      - Mock usb.ts, pgrep, lsof
      - Test connected/not-connected/ACECode-running/port-busy scenarios
- [ ] 6.2 Write `tests/unit/health.test.ts`:
      - Mock detect, esptool, serial
      - Test full flow, skipFlash, ACECode-block, timeout scenarios
- [ ] 6.3 Write `tests/unit/parsers.test.ts`:
      - Valid JSON lines parse correctly
      - Malformed lines skipped
      - Terminal health line detected
- [ ] 6.4 Run `pnpm test` — all unit tests pass, 0 hardware access

## Phase 7: Integration Test Scaffold

- [ ] 7.1 Write `tests/integration/hardware.test.ts`:
      - Skip if `ACEBOTT_HW != 1`
      - Test robot_detect returns connected: true
      - Test robot_health returns parsed report
      - Document how to enable in README

## Phase 8: Install + Documentation

- [ ] 8.1 Write `harness/README.md`:
      - What it is, why
      - Install via symlink instructions
      - How to run tests (unit vs integration)
      - Troubleshooting (esptool path, ACECode running, etc.)
- [ ] 8.2 Create install script or document symlink command:
      `ln -s ~/Developer/acebott/harness ~/.pi/agent/extensions/acebott-harness`
- [ ] 8.3 Verify tsx loads the extension: start Pi, `/reload`, check
      `/tools` shows robot_detect and robot_health (RISK-06 verification)

## Phase 9: Verify (post-implementation gate)

- [ ] 9.1 Run `pnpm test` — all unit tests pass
- [ ] 9.2 Run `pnpm build` — 0 type errors
- [ ] 9.3 (If hardware available) `ACEBOTT_HW=1 pnpm test` — integration
      tests pass against real QD001
- [ ] 9.4 Manual test: call robot_detect from Pi against real robot
- [ ] 9.5 Manual test: call robot_health from Pi, confirm LEDs blink +
      buzzer + serial report
