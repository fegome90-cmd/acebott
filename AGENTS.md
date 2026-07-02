# Acebott QD001 — Robotics Development Repo

> Personal workspace for Acebott QD001 ESP32 MAX V1.0 robotics development.
> Three pillars: **firmware code**, **knowledge wiki**, and **reusable skills**.

---

## Architecture Overview

This repo combines three layers that work together:

```
┌─────────────────────────────────────────────────────────────┐
│                     SKILLS LAYER                             │
│  skills/ — reusable AI-agent procedures                     │
│  (arduino-dev, esp32, embedded, project-builder, community) │
│  + external: acebott-esp32-flash (~/.pi/agent/skills/)      │
└──────────────────────────┬──────────────────────────────────┘
                           │ guides
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    FIRMWARE & CODE LAYER                     │
│  Sketches (.ino) · Host scripts (python/bash)               │
│  arduino-cli compile → esptool flash → serial monitor       │
│  OpenSpec tracks changes (openspec/changes/)                │
└──────────────────────────┬──────────────────────────────────┘
                           │ informs
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    KNOWLEDGE WIKI LAYER                      │
│  .llm-wiki/ — project brain (gitignored)                    │
│  concepts · entities · analyses · syntheses · sources        │
│  Mined from official tutorials + real experimentation        │
└─────────────────────────────────────────────────────────────┘
```

**Tech Stack:**
- **MCU**: ESP32-D0WD-V3 (Arduino core 2.0.18)
- **Serial**: CH340/CH341 (WCH, VID 0x1A86 PID 0x7523) — NOT CP210x
- **Toolchain**: `arduino-cli` 1.5.1 (brew), esptool bundled ACECode @ 115200
- **Host scripts**: Python (`uv` + `pyserial`), Bash
- **Testing**: pytest (host-side), hardware-validation gate (firmware)
- **SDD**: OpenSpec (`openspec/config.yaml`)

---

## Hardware

- **Robot**: Acebott QD001 ESP32 MAX V1.0
- **Port**: `/dev/cu.usbserial-*` (macOS built-in CH340 driver)
- **Pin map**: wiki → `entities/qd001-pin-map.md`
- **WiFi baseline**: AP `ESP32-Car` / `12345678`, server `http://192.168.4.1:80`
- **API**: `GET /Car?move={f|b|l|r|s|tl|tr}`

Reference materials (installers, guides, drivers) in `Español/` and
`ACECode Setup-Mac-x86/` — both gitignored, kept locally only.

---

## File Structure

```
acebott/
├── AGENTS.md                     ← this file (project guidelines)
├── skills/                       ← reusable AI-agent skills
│   ├── arduino-development/
│   ├── esp32-arduino-development/
│   ├── embedded-systems-engineering/
│   ├── arduino-project-builder/
│   └── arduino-community-notes/
├── openspec/                     ← SDD specs and change tracking
│   ├── config.yaml               ← project context + testing rules
│   ├── specs/                    ← baseline specs
│   └── changes/                  ← active proposals
├── docs/                         ← technical analyses
│   └── seguridad/                ← third-party skill security reviews
├── .llm-wiki/                    ← knowledge vault (gitignored)
│   ├── wiki/                     ← concepts, entities, syntheses
│   ├── raw/sources/              ← immutable source packets
│   ├── meta/                     ← auto-generated metadata
│   └── outputs/                  ← lint reports
├── Español/                      ← official tutorials (gitignored)
└── ACECode Setup-Mac-x86/       ← bundled installer (gitignored)
```

---

## Knowledge Wiki (`.llm-wiki/`)

The project's brain — accumulated understanding of hardware, sensors,
protocols, and course materials.

**Key pages:**
- `wiki/syntheses/project-status-acebott-qd001.md` — living project snapshot
- `wiki/syntheses/acebott-course-curriculum.md` — 22 sketches, 4 modules
- `wiki/entities/qd001-pin-map.md` — complete GPIO assignments
- `wiki/entities/acbsmartcarv2-library.md` — full API reference (150ms spin gotcha)
- `wiki/concepts/` — per-sensor deep dives (ultrasonic, IR, line-tracking, servo)

**Wiki workflow:**
- Source materials ingested as immutable packets in `raw/sources/`
- Knowledge extracted into `wiki/` pages
- Schema: `.llm-wiki/WIKI_SCHEMA.md`
- Lint reports: `.llm-wiki/outputs/`

---

## Skills (`skills/`)

Reusable procedures for AI agents working on this project.

| Skill | Purpose |
|-------|---------|
| `esp32-arduino-development` | Default for ESP32: toolchain, FQBN, compile, flash, PWM, NVS, WiFi, troubleshooting |
| `embedded-systems-engineering` | Firmware quality: ISR rules, RTOS, volatile, watchdog, code review, security |

**External skill** (user-level, not in this repo):

`acebott-esp32-flash` at `~/.pi/agent/skills/acebott-esp32-flash/` —
progressive-disclosure skill for the canonical flash workflow. **Load before
any firmware operation.** Covers: environment setup, diagnosis, esptool
recipe, boot verification, ACECode troubleshooting, firmware variants.

---

## Code Patterns

### Sketch Structure (.ino)

```cpp
// Include ACB_SmartCar_V2 library for motor/sensor abstraction
#include <ACB_SmartCar_V2.h>

// Globals at top, setup() then loop()
// Use meaningful pin names, not magic numbers
const int TRIG_PIN = 5;
const int ECHO_PIN = 18;

void setup() {
  Serial.begin(115200);  // Always 115200 — matches flash baud
  // Initialize peripherals
}

void loop() {
  // Non-blocking where possible (avoid delay() in WiFi sketches)
}
```

### Naming Conventions

- **Sketches**: match official tutorial names (e.g. `4.3Web_control_car`)
- **Variables**: `snake_case` for pins/constants, `camelCase` for functions
- **Sensor variables**: prefix with sensor type (`us_distance`, `ir_left`, `line_center`)
- **Files**: kebab-case for docs, snake_case for Python scripts

### Motor Control (ACB_SmartCar_V2)

```cpp
// ⚠️ 150ms minimum spin time — shorter pulses may not register
car.forward(speed);   // speed: 0-255
car.backward(speed);
car.left(speed);
car.right(speed);
car.stop();
// For precise turns, use timed pulses:
car.left(150);
delay(150);
car.stop();
```

### WiFi Sketch Pattern

```cpp
// AP mode, not STA — the car broadcasts its own network
WiFi.softAP("ESP32-Car", "12345678");
server.on("/Car", HTTP_GET, handleCar);  // ?move=f|b|l|r|s|tl|tr
server.begin();
```

### Host Scripts (Python)

```python
# Always use exception chaining
raise ValueError(f"Port {port} not found") from e

# Serial monitor pattern
import serial
s = serial.Serial('/dev/cu.usbserial-110', 115200, timeout=1)
```

---

## Testing Requirements

Adapted TDD — different layers, different gates.

### Host-Side Scripts (Python/Bash)

```bash
uv run pytest              # unit tests
uv run pytest --cov        # with coverage
shellcheck scripts/*.sh    # bash linting
```

**Must pass before commit.** Target: 80% coverage on host-side code.

### Firmware (Arduino C++)

Hardware-validation gate (the ESP32 can't run pytest):

1. `arduino-cli compile` — clean build, no errors
2. Flash via canonical esptool recipe (see `acebott-esp32-flash` skill)
3. Serial monitor confirms expected boot output
4. Functional test: AP visible, car responds to commands

**Gate**: compile + flash + serial verify = pass.

### Pre-Commit Checklist

- [ ] Host scripts: `uv run pytest` passes
- [ ] Bash scripts: `shellcheck` clean
- [ ] Firmware: compiles without errors
- [ ] No hardcoded secrets or WiFi credentials in tracked files
- [ ] Conventional Commit message ready

---

## Flash Workflow

Fully documented in the `acebott-esp32-flash` skill. **Do not inline flash
recipes here — keep this file general.**

**TL;DR**: `arduino-cli compile` → `esptool bundled @ 115200` → serial monitor.
Never use `arduino-cli upload` (forces 921600 baud → 0xE0 on CH340).

---

## OpenSpec (`openspec/`)

Spec-Driven Development config and change tracking.

- `config.yaml` — project context, testing strategy, rules (RFC 2119)
- `changes/` — active change proposals (e.g. `add-pi-acebott-harness`)
- `specs/` — baseline specs (populate as project matures)

Change proposals follow: `proposal.md` → `design.md` → `spec.md` → `tasks.md`.

---

## Critical Rules

1. **Never `arduino-cli upload`** — forces 921600 baud, causes 0xE0 on CH340.
   Use esptool bundled with ACECode at 115200.
2. **CH340, not CP210x** — driver confusion wastes hours. VID `0x1A86`, PID `0x7523`.
3. **Kill ACECode before flash** — it holds the serial port and revives itself.
   `pkill -9 -f ACECode`
4. **FQBN is `esp32:esp32:esp32`** — not `arduino:esp32:esp32`.
5. **150ms minimum spin** — shorter motor pulses may not register on V1.0.
6. **Never `git add -A`** — stage specific paths. Too much reference material is gitignored.
7. **Conventional Commits** — feat/fix/refactor/docs/test/chore.
8. **Load `acebott-esp32-flash` skill** before any compile/flash/debug operation.
9. **Wiki is read-only during sessions** — modify via wiki workflow only.
10. **No claims without evidence** — serial output, compile log, or hardware observation.

---

## Development Notes

- **WiFi baseline validated**: `4.3Web_control_car` works on V1.0
- **Open issue**: iOS Safari rendering bug in WebControlCar HTML page
  (wiki → `analyses/webcontrolcar-ios-safari-bug.md`)
- **MicroPython**: `QDpython-firmware.bin` flashes and boots on V1.0
- **GitHub refs**: `directorcia/Azure`, `PZyhat/acebott-qd007`, `Emmanuelprime/acebott-qd001-pro`

---

## Related Skills

- `acebott-esp32-flash` — canonical flash workflow (external, user-level)
- `acebott-esp32-flash` — canonical flash workflow (external, user-level)
- `sdd-init` — OpenSpec initialization and project context detection
- `project-guidelines-example` — template used to structure this file

Archived reference docs (not skills) in `docs/seguridad/` and `docs/references/`.

---

*This file follows the `project-guidelines-example` pattern. Keep it
general — specific procedures belong in skills or wiki pages.*
