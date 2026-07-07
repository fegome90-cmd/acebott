# Design — cerrar-gaps-ecoeficiencia

> SDD design phase. Concrete artifact layout, validation strategy, and
> implementation constraints for the `cerrar-gaps-ecoeficiencia` change.
> References: `proposal.md`, `spec.md`, `exploration.md`, `openspec/config.yaml`.

## Overview

This change is documentation/skill-heavy with one firmware utility. It adds
three new ESP32 skills, extends one existing skill, adds a line-follower
calibration utility, and updates the skills index.

The implementation MUST preserve the repo baseline:

- Board/FQBN: `esp32:esp32:esp32`
- Arduino-ESP32 core: 2.0.18
- Serial baud: 115200
- Flash workflow: compile -> esptool @115200 -> serial monitor
- No `arduino-cli upload`
- No Arduino core 3.x upgrade
- No external dependency installation without explicit user confirmation

## File Layout

```text
skills/
├── esp32-ota/
│   ├── SKILL.md
│   └── examples/
│       ├── arduino_ota_dev/arduino_ota_dev.ino
│       └── https_ota_ab/https_ota_ab.ino
├── esp32-displays/
│   ├── SKILL.md
│   └── examples/
│       ├── ssd1306_minimal/ssd1306_minimal.ino
│       └── neopixel_minimal/neopixel_minimal.ino
├── esp32-ble/
│   ├── SKILL.md
│   └── examples/
│       └── bledevice_minimal/bledevice_minimal.ino
├── esp32-connectivity/
│   └── SKILL.md
├── qd001-sensors/
│   ├── SKILL.md
│   └── examples/
│       └── line_follower_calibration/line_follower_calibration.ino
└── README.md
```

### Why examples live under each skill

Examples belong with the skill that teaches them. This keeps the skill
self-contained and makes validation straightforward: every skill has a visible
compile target. This is better than scattering sketches under a generic `tools/`
folder because the next agent would have to reverse-map examples to skills.

## Skill Design Contracts

### `skills/esp32-ota/SKILL.md`

Sections:

1. When to use
2. Baseline constraints for QD001
3. Development OTA: ArduinoOTA over trusted LAN
4. Production OTA: HTTPS OTA with server certificate validation
5. Partition and rollback checklist
6. Image signing / Secure Boot out of scope
7. Validation workflow
8. Gotchas
9. Sources

Production OTA MUST teach the difference between:

- Transport security: HTTPS server certificate validation
- Image authenticity: out of scope for this change unless Secure Boot or explicit
  image signature verification is designed later
- Image acceptance: rollback state and first-boot self-test, only when bootloader
  rollback support is demonstrated
- Recovery: USB/esptool fallback if OTA path fails

The production example SHOULD be a minimal compile-oriented sketch using the
Arduino-ESP32 2.0.18-facing `HttpsOTAUpdate.h` API, not a complete deployment
server. It MAY mention the lower-level ESP-IDF `esp_https_ota` C API as the
underlying mechanism, but the example contract is `HttpsOTAUpdate.h` to avoid
mixing version-specific APIs. It MAY use placeholder URL/cert strings, but MUST
make placeholders obvious.

Required OTA rollback points:

- OTA requires `ota_0`, `ota_1`, and `otadata`.
- Rollback is not "magic"; it depends on bootloader rollback support such as
  `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE` where available.
- `ota_0`, `ota_1`, and `otadata` are necessary but not sufficient.
- The skill MUST NOT suggest enabling rollback by defining a macro in the sketch
  or by passing application-only compiler flags.
- If bootloader rollback support cannot be demonstrated for the flashed
  Arduino-ESP32 core/bootloader, the skill MUST document rollback as a required
  production design constraint, not as validated behavior.
- First boot after update MUST run self-test.
- App MUST be marked valid only after self-test succeeds, using
  `esp_ota_mark_app_valid_cancel_rollback()` or the Arduino-accessible
  equivalent.
- If self-test fails, the app SHOULD trigger rollback/reboot.

Expected serial output for validation:

```text
[OTA] Booting firmware version: <version>
[OTA] Current partition: <partition-name>
[OTA] Rollback state: <state-or-unavailable>
[OTA] Self-test: PASS
[OTA] App marked valid
```

### `skills/esp32-displays/SKILL.md`

Sections:

1. When to use
2. QD001 compatibility warning
3. OLED SSD1306 via Adafruit API
4. GFX drawing primitives
5. NeoPixel basics
6. Acebott `ACB_Adafruit_*` wrapper note
7. Validation workflow
8. Gotchas
9. Sources

The design intentionally uses original Adafruit APIs. The skill MUST NOT pretend
the precompiled Acebott wrapper has been inspected. Say the quiet part out loud:
the wrapper is expected to mirror Adafruit, but exact fidelity is unverified.

Example targets:

- `ssd1306_minimal.ino`: compile-only baseline with placeholder I2C address
  `0x3C`.
- `neopixel_minimal.ino`: compile-only baseline with a clearly configurable
  `NEOPIXEL_PIN`.

TFT is intentionally out of scope for this delivery. It MAY be mentioned as a
related display category, but the skill MUST NOT claim TFT coverage or include a
TFT success criterion.

Expected serial output:

```text
[DISPLAY] SSD1306 init: OK
[DISPLAY] Drawing test pattern
[NEOPIXEL] Pixel test complete
```

### `skills/esp32-ble/SKILL.md`

Sections:

1. When to use
2. Default: native `BLEDevice`
3. Minimal BLE server example
4. NimBLE as opt-in alternative
5. WiFi/BLE coexistence
6. Validation workflow
7. Gotchas
8. Sources

Defaulting to `BLEDevice` is a security/workflow choice, not a claim that it is
more efficient than NimBLE. NimBLE remains an alternative when memory pressure is
measured and the user explicitly approves the dependency.

Expected serial output:

```text
[BLE] BLEDevice initialized
[BLE] Service started
[BLE] Advertising started
```

### `skills/esp32-connectivity/SKILL.md`

Add `### mTLS / Mutual TLS` immediately after the current TLS/MQTTS section and
before HTTP client material. The existing TLS section is around the MQTTS
guidance, so mTLS belongs there conceptually.

The mTLS section MUST include:

- `WiFiClientSecure`
- `setCACert(...)`
- `setCertificate(...)`
- `setPrivateKey(...)`
- fake placeholder PEM blocks
- warning not to commit real private keys
- note about flash/PROGMEM cost

Example shape:

```cpp
WiFiClientSecure secure_client;
secure_client.setCACert(ROOT_CA);
secure_client.setCertificate(CLIENT_CERT);
secure_client.setPrivateKey(CLIENT_KEY);
```

Do not remove or weaken the existing `setInsecure()` warning.

### `skills/qd001-sensors/examples/line_follower_calibration/line_follower_calibration.ino`

The calibration utility is a setup-time sketch, not runtime auto-calibration.
The operator uses Serial Monitor to place the robot/sensor over black and white
surfaces and confirms each step.

Hardware pin mapping:

| Sensor | GPIO | Notes |
|--------|------|-------|
| Left | 35 | Analog input, line-tracking left |
| Middle | 36 | Analog input, 3-sensor variant |
| Right | 39 | Analog input, line-tracking right |

NVS design:

| Namespace | Key | Value |
|-----------|-----|-------|
| `qd001` | `line_l` | left threshold |
| `qd001` | `line_m` | middle threshold |
| `qd001` | `line_r` | right threshold |
| `qd001` | `off_road` | off-road threshold, default 4000 |
| `qd001` | `line_cal_v` | calibration completion marker, write last |

Sampling arithmetic MUST use at least `uint32_t` for accumulated raw readings.
Final averages and persisted threshold values MAY be stored as
`uint16_t`/`getUShort` because ADC readings fit in 0-4095. Runtime snippets
SHOULD trust NVS thresholds only when `line_cal_v == 1` and otherwise fall back
to safe defaults:

```cpp
bool calibrated = prefs.getUShort("line_cal_v", 0) == 1;
left_threshold = calibrated ? prefs.getUShort("line_l", 2000) : 2000;
off_road = calibrated ? prefs.getUShort("off_road", 4000) : 4000;
```

Calibration flow:

1. Print pin map and instructions at 115200 baud.
2. For each sensor, sample black surface N times and average.
3. For each sensor, sample white surface N times and average.
4. Compute contrast and midpoint threshold per sensor.
5. Reject the entire calibration if any sensor has insufficient contrast.
6. Persist thresholds to namespace `qd001` only after all three sensors pass.
7. Write `line_cal_v=1` last as the completion marker.
8. Read values back and print confirmation.

Expected serial output:

```text
[CAL] QD001 line follower calibration
[CAL] Pins: left=35 middle=36 right=39
[CAL] Sampling LEFT black...
[CAL] Sampling LEFT white...
[CAL] left threshold saved: <value>
[CAL] middle threshold saved: <value>
[CAL] right threshold saved: <value>
[CAL] off_road saved: 4000
[CAL] line_cal_v saved: 1
[CAL] Verification readback: PASS
```

### `skills/qd001-sensors/SKILL.md`

Add a short section pointing to the calibration example and showing the runtime
load snippet. Keep the existing warning about the `Middle` sensor inconsistency.
Do not rewrite the existing sensor skill wholesale.

### `skills/README.md`

Update:

- Top count: 11 -> 14 curated skills
- Generic ESP32 group: add `esp32-ota`, `esp32-displays`, `esp32-ble`
- Capability table: add OTA, displays, BLE
- Gaps: remove OTA/displays/BLE/mTLS from uncovered list
- Gaps: keep ULP as future work/out-of-scope

## Validation Strategy

### Static validation

- Markdown links point to existing files.
- Every new skill has frontmatter with `name` and `description`.
- Every new example path exists and is referenced by its skill.
- No examples contain real credentials, real private keys, or production
  endpoints.
- Dependency preflight records exact installed Arduino libraries before
  compiling examples that require external libraries.

### Firmware compile validation

Compile each example with:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 <example-directory>
```

Validation MUST NOT use:

```bash
arduino-cli upload
```

If an example depends on an external library such as Adafruit SSD1306,
Adafruit GFX, or Adafruit NeoPixel, validation first checks whether the library
is already installed and records its version. If missing, only that target is
blocked pending explicit user authorization; the gate MUST NOT be downgraded to
"should compile".

### Hardware validation

Only the calibration utility requires hardware behavior validation in this
change. The minimum hardware gate is:

1. Compile clean.
2. Flash using canonical esptool @115200 workflow.
3. Open serial monitor at 115200.
4. Confirm the expected `[CAL]` output.
5. Confirm thresholds persist after reset.

OTA examples SHOULD be compile-validated. Production OTA behavior, firmware
image authenticity, Secure Boot, anti-rollback by version, and automatic
bootloader rollback SHOULD NOT be claimed until a dedicated OTA test environment
and bootloader capability check exist.

## Risks and Mitigations

| Risk | Design mitigation |
|------|-------------------|
| Acebott display wrappers differ from Adafruit API | Skill states wrapper fidelity is unverified and uses Adafruit API as source of truth |
| NimBLE dependency creep | BLEDevice remains default; NimBLE is opt-in only |
| OTA rollback misunderstood | OTA skill separates HTTPS transport, image authenticity, partition layout, and bootloader rollback support |
| Real secrets committed in mTLS examples | Use fake PEM placeholders and explicit warning |
| Calibration corrupts runtime assumptions | Validate contrast before write, write all values before `line_cal_v`, use safe defaults when marker is absent |
| Existing Git state is noisy | Tasks MUST stage only specific paths for this change |

## Implementation Order

1. Run preflight for toolchain, installed Arduino libraries, and rollback
   capability evidence.
2. Create the three new skill directories and minimal examples.
3. Add mTLS section to `esp32-connectivity`.
4. Add calibration example and pointer from `qd001-sensors`.
5. Update `skills/README.md`.
6. Run static checks.
7. Compile examples whose dependencies are available.
8. Hardware-validate calibration if the board is available.

## Open Questions

- Exact production OTA partition CSV and bootloader rollback capability are not
  selected in this design. `tasks.md` should require documenting `default`,
  `min_spiffs`, and a custom OTA partition option rather than silently changing
  the board configuration. It should also require evidence before claiming
  automatic rollback.
- Display example pins are intentionally placeholders unless a specific QD001
  display module is connected.
- BLE service UUIDs can be arbitrary demo UUIDs; production UUID allocation is
  out of scope.
