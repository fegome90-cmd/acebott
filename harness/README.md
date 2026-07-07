# @acebott/harness

Pi domain harness for the Acebott QD001 ESP32 MAX V1.0 robot.

Gives the Pi coding agent native TypeScript tools for hardware detection,
health checking, and firmware operations — turning a generalist agent into
a hardware expert.

## What It Does

| Tool | Description |
| --- | --- |
| `robot_detect` | Detect robot: port, chip (CH340), ACECode state, port busy, esptool available |
| `robot_health` | Flash self-test firmware, read serial, return structured health report |
| `robot_skills` | Discover and fetch domain skills: list, recommend by area, get full SKILL.md |

The health check tests: LEDs (blink), buzzer (beep), motors (Init-only, NO
movement), ultrasonic (distance), tracking (3 sensors), IR (code detection).

## Installation (Local Symlink)

No npm publish. Install via symlink:

```bash
# Create the symlink
ln -s ~/Developer/acebott/harness ~/.pi/agent/extensions/acebott-harness

# Reload Pi to pick up the extension
/reload
```

Verify:

```bash
# Check tools are registered
/tools
# Should show: robot_detect, robot_health, robot_skills
```

Uninstall:

```bash
rm ~/.pi/agent/extensions/acebott-harness
/reload
```

## Development

```bash
# Install deps
pnpm install

# Type check
pnpm build

# Run unit tests (no hardware needed)
pnpm test

# Run with watcher
pnpm test:watch

# Run integration tests (requires real hardware)
ACEBOTT_HW=1 pnpm test:integration
```

## Guardrails

These invariants are baked into the tools and CANNOT be overridden:

1. **Baud always 115200** — never 921600 (causes `0xE0` on CH340)
2. **Blocks if ACECode running** — offers interactive kill
3. **Uses bundled esptool only** — never `arduino-cli upload`
4. **Motors test does NOT move** — Init-only (no desk launches)
5. **Serial timeout 10s** — never hangs forever

## Firmware

The `firmware/health_check/health_check.ino` sketch is purpose-built for
the health check tool. It tests all peripherals and emits JSON-lines
output over serial.

Compile independently:

```bash
cd firmware/health_check
arduino-cli compile --fqbn esp32:esp32:esp32 .
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| esptool not found | Ensure ACECode is installed at `/Applications/ACECode.app/` |
| ACECode holds port | `pkill -9 -f ACECode` before health check |
| 0xE0 flash error | This should not happen (baud is hardcoded 115200). If it does, check USB cable. |
| No serial output | Check the robot is powered on and the USB cable is data-capable |
| Compile fails | Ensure `ACB_SmartCar_V2` library is installed in `~/Documents/Arduino/libraries/` |

## Architecture

```
harness/
├── src/
│   ├── index.ts              ← extension factory (registers tools)
│   ├── tools/
│   │   ├── detect.ts         ← robot_detect tool
│   │   ├── health.ts         ← robot_health tool
│   │   └── skills.ts         ← robot_skills tool
│   └── lib/
│       ├── constants.ts      ← FQBN, baud, pins, esptool path
│       ├── usb.ts            ← CH340 detection via ioreg
│       ├── serial.ts         ← pyserial wrapper with timeout
│       ├── arduino-cli.ts    ← compile wrapper
│       ├── esptool.ts        ← flash wrapper (guardrailed)
│       ├── parser.ts         ← JSON-lines health report parser
│       └── skills-index.ts   ← skill types, parser, scan/get/recommend
├── firmware/
│   └── health_check/
│       └── health_check.ino  ← self-test firmware
├── skill/
│   └── SKILL.md              ← domain skill
└── tests/
    ├── unit/                 ← vitest, all mocked
    └── integration/          ← opt-in, real hardware
```

## Related

- **Skill**: `acebott-esp32-flash` — canonical flash workflow for manual flashing
- **Wiki**: `.llm-wiki/wiki/` — full Acebott knowledge base
- **SDD**: `openspec/changes/add-pi-acebott-harness/` — design artifacts
