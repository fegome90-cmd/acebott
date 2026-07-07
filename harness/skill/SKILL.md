    ---
name: acebott-harness
description: >
  Use when working with the Acebott QD001 ESP32 robot. Provides three native
  tools: robot_detect (detect robot, port, chip, ACECode state), robot_health
  (flash self-test firmware, parse health report), and robot_skills (discover
  and fetch domain skills for motors, sensors, servo, IR, LEDs, buzzer, app,
  embedded, esp32, flash, and web). Trigger when the user asks about robot
  status, hardware health, sensor readings, firmware operations, or needs to
  find the right skill for a task.
metadata:
  author: felipe-gonzalez
  version: "0.2.0"
---

# Acebott Harness

Domain harness for the Acebott QD001 ESP32 MAX V1.0. Gives the agent
native tools for hardware detection, health checking, and firmware
operations.

## Tools

### `robot_detect`

Detects the connected robot. Read-only — no side effects.

**Returns**: port path, USB chip (CH340 vendor/product IDs), whether
ACECode is running, whether the port is busy, and whether the bundled
esptool is available.

**Use before**: any firmware operation, health check, or when the user
asks "is the robot connected?"

### `robot_health`

Runs a full hardware self-test by flashing `health_check.ino` and
reading the serial output.

**Tests**: LEDs (blink), buzzer (beep), motors (Init-only, NO movement),
ultrasonic (distance), tracking (3 sensors), IR (code detection).

**Returns**: structured report with pass/fail per component.

**Use when**: verifying hardware after assembly, before development,
or debugging unexpected behavior.

**Parameter `skipFlash`**: set to `true` if the health firmware is
already flashed and you just want to read serial output.

### `robot_skills`

Discovers and fetches domain skills from the repo-root `skills/` directory.
Read-only — no hardware access.

**Actions**:
- `list` — return all skills with names, paths, and area tags
- `recommend <area>` — return the best skill for a given area
- `get <name>` — return full SKILL.md content (frontmatter + body)

**Areas**: motors, sensors, servo, ir, leds, buzzer, app, embedded, esp32,
flash, web. Aliases are first-class: `leds`/`buzzer` both resolve to
`qd001-leds-buzzer`; `app`/`web` both resolve to `qd001-app-control`.

**Flash**: resolves to the external user-level skill at
`~/.pi/agent/skills/acebott-esp32-flash/`. Returns an actionable error
if not installed.

**Use when**: the agent needs to find the right skill for a task, read
a skill's full content, or discover what skills are available.

## Guardrails

These are baked into the tools and CANNOT be overridden:

1. **Baud always 115200** — never 921600 (causes 0xE0 error on CH340)
2. **Blocks if ACECode running** — offers to kill interactively
3. **Uses bundled esptool only** — never `arduino-cli upload`
4. **Motors test does NOT move** — Init-only (safety: no desk launches)
5. **Serial timeout 10s** — never hangs forever

## Pin Map (Quick Reference)

| Component | Pin(s) |
| --- | --- |
| Motors 1-4 | via ACB_SmartCar_V2.Init() |
| Ultrasonic | trig=13, echo=14 |
| Servo | 25 |
| LED left | 12 |
| LED right | 2 |
| Buzzer | 33 |
| IR receiver | 4 |
| Tracking left | 35 |
| Tracking middle | 36 |
| Tracking right | 39 |

## Related Skills

- `acebott-esp32-flash` — canonical flash workflow (manual, when you
  need to flash a specific sketch rather than the health check)

## Installation

```bash
ln -s ~/Developer/acebott/harness ~/.pi/agent/extensions/acebott-harness
```

Then `/reload` in Pi to activate.
