# Skills — Acebott QD001 (ESP32)

> Curated skills for ESP32/Arduino development on the Acebott QD001 robot.

Hardware: **Acebott QD001 ESP32 MAX V1.0** — ESP32-D0WD-V3, Arduino core 2.0.18,
CH340/CH341 serial, port `/dev/cu.usbserial-*`.

## Active Skills

| Skill | When to Load |
|-------|--------------|
| [`esp32-arduino-development`](esp32-arduino-development/) | Default for ESP32 work: toolchain, FQBN, compile, flash, PWM, NVS, WiFi APIs, troubleshooting |
| [`embedded-systems-engineering`](embedded-systems-engineering/) | Firmware quality: ISR rules, RTOS, volatile, watchdog, code review, security checklist |

**External** (user-level, not in this repo):

- `acebott-esp32-flash` at `~/.pi/agent/skills/acebott-esp32-flash/` —
  canonical flash workflow. Load before any compile/flash/debug operation.

## Archived (moved to docs/)

These were reference/evaluation documents, not active skills. Moved to `docs/`:

| Document | Location | Why Archived |
|----------|----------|--------------|
| LobeHub skill analysis | `docs/seguridad/lobehub-skill-analysis.md` | Mission accomplished — evaluated, decided not to install |
| Community notes | `docs/references/community-notes.md` | Inspiration only, not a procedural skill |

## Security

- All skills were curated: online content treated as untrusted data
- All executable imperatives neutralized to "requires explicit user confirmation"
- **Never install marketplace skills** via `npx -y` — supply-chain risk
- See `docs/seguridad/` for full security analyses

## Future Skills (gaps)

Skills that don't exist yet but would be useful:

- **`acebott-qd001-patterns`** — robot-specific patterns: mecanum motors, ultrasonic + servo scan, 3-sensor line tracking, app protocol, IR remote codes
- **`esp32-concurrency`** — FreeRTOS concrete API (xTaskCreate, queues, mutexes) — only principles exist today
- **`esp32-connectivity`** — WiFi/BLE/MQTT/HTTP with real code examples

## Sources

- `esp32-arduino-development` — https://github.com/EricSun787/esp32-arduino-development
- `embedded-systems-engineering` — https://snyk.io/es/articles/claude-skills-embedded-systems-engineers/
