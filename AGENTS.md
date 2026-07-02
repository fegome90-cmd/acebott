# Acebott QD001 — Personal Development Repo

> Personal workspace for Acebott QD001 ESP32 MAX V1.0 robotics development.
> Logs, firmware experiments, automation scripts, and accumulated knowledge.

## Hardware Target

- **Robot**: Acebott QD001 ESP32 MAX V1.0
- **MCU**: ESP32-D0WD-V3 (ESP32 Arduino core 2.0.18)
- **USB-Serial chip**: CH340/CH341 (WCH/Qinheng, VID 0x1A86 PID 0x7523)
- **NOT CP210x** — previous memory was wrong, corrected 2026-07-01
- **Port**: `/dev/cu.usbserial-*` (macOS Sierra+ has built-in driver)

## Critical Skill — Load Before Any Firmware Work

**MANDATORY**: Before compiling, flashing, or debugging firmware,
load the `acebott-esp32-flash` skill:

```
/Users/felipe_gonzalez/.pi/agent/skills/acebott-esp32-flash/SKILL.md
```

This skill uses progressive disclosure. The orchestrator `SKILL.md` loads
the relevant resource file based on the task:

| Task | Resource |
| --- | --- |
| Environment setup | `resources/00-environment-setup.md` |
| Hardware basics (chip IDs, drivers) | `resources/00b-hardware-basics.md` |
| Diagnose flash errors (0xE0, etc.) | `resources/01-diagnose.md` |
| Flash via esptool (canonical recipe) | `resources/02-flash-via-esptool.md` |
| Verify boot via serial monitor | `resources/03-verify-boot.md` |
| Troubleshoot ACECode UI failures | `resources/04-troubleshoot-acecode-ui.md` |
| Firmware variants (QD, QE, MicroPython) | `resources/05-firmware-variants.md` |

Helper script: `scripts/flash-acebott.sh` (modes: generic, qd, qe, qdcam).

## Canonical Flash Workflow

Validated end-to-end 2026-07-01. Do NOT deviate without evidence.

```bash
# 1. Kill ACECode (it holds the port and revives itself)
pkill -9 -f ACECode

# 2. Verify port is free
ls /dev/cu.usbserial-* && lsof /dev/cu.usbserial-*

# 3. Compile (FQBN esp32:esp32:esp32, NOT arduino:esp32:esp32)
arduino-cli compile --fqbn esp32:esp32:esp32 \
  --build-path /tmp/qd_build ~/Documents/Arduino/<SKETCH>

# 4. Flash with esptool BUNDLED ACECode @ 115200
#    (NOT arduino-cli upload — it forces 921600 and gives 0xE0)
/Applications/ACECode.app/Contents/extraFiles-mac/compile/burner/esptool \
  --chip esp32 --port /dev/cu.usbserial-110 --baud 115200 \
  --before default_reset --after hard_reset write_flash -z \
  --flash_mode dio --flash_freq 80m --flash_size detect \
  0x1000  bootloader.bin \
  0x8000  partitions.bin \
  0xe000  boot_app0.bin \
  0x10000 firmware.bin

# 5. Verify via serial monitor
uv run --with pyserial python -c "import serial,time; s=serial.Serial('/dev/cu.usbserial-110',115200,timeout=1); [print(s.readline().decode(errors='replace').strip()) for _ in iter(lambda: time.sleep(0.1), None)]"
```

### Anti-patterns (confirmed broken)

- `arduino-cli upload` → forces 921600 baud → `StopIteration` / `0xE0`
- Arduino IDE GUI → disobeys Tools→Upload Speed setting
- `esptool 5.3.0` from ESP32 core → unreliable on CH340 at high baud

## Testing & Quality (Adapted TDD)

This project uses **adapted TDD** — different layers, different gates:

| Layer | Tool | Gate |
| --- | --- | --- |
| Host scripts (python/bash) | `uv run pytest`, `shellcheck` | Must pass before commit |
| Firmware (Arduino C++) | arduino-cli compile + flash + serial | Boot output matches expected |

Run checks:

```bash
uv run pytest                    # host-side unit tests
uv run pytest --cov              # with coverage
shellcheck scripts/*.sh          # bash linting
```

## Project Layout

```
acebott/
├── AGENTS.md                   ← this file
├── openspec/                   ← SDD specs, changes, config.yaml
│   ├── config.yaml
│   ├── specs/
│   └── changes/
├── .llm-wiki/                  ← project-local knowledge vault
│   ├── wiki/                   ← editable knowledge pages
│   ├── raw/sources/            ← immutable source packets
│   └── meta/                   ← auto-generated metadata
├── ACECode Setup-Mac-x86/      ← bundled installer (reference)
└── Español/                    ← official Acebott tutorials (reference)
```

## Development Notes

- **WiFi baseline validated**: sketch `4.3Web_control_car` works on V1.0
  (AP `ESP32-Car` / `12345678`, server `http://192.168.4.1:80`)
- **API**: `GET /Car?move={f|b|l|r|s|tl|tr}`
- **Open issue**: HTML page does not render correctly on iOS Safari
- **GitHub refs**: `directorcia/Azure`, `PZyhat/acebott-qd007`, `Emmanuelprime/acebott-qd001-pro`

## Conventions

- Conventional Commits (feat/fix/refactor/docs/test/chore)
- Atomic commits, never force push to main
- Never `git add -A` — always stage specific paths
- Exception chaining in Python: `raise ValueError(...) from e`
- Code comments and docs in English
