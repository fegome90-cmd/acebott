# Spec — cerrar-gaps-ecoeficiencia

> SDD spec phase. Requisitos formales con escenarios Given/When/Then.
> References: `proposal.md`, `exploration.md`, `skills/README.md`, `openspec/config.yaml`.

## Requirements

### REQ-001: Skill `esp32-ota`

The repository MUST add `skills/esp32-ota/SKILL.md` as a curated ESP32 OTA skill
for Arduino-ESP32 core 2.0.18. The skill MUST distinguish development OTA from
production OTA: ArduinoOTA MAY be documented for trusted LAN/dev use, while
production OTA MUST use HTTPS OTA guidance, server certificate validation, and
an A/B rollback plan conditioned on demonstrated bootloader support.

HTTPS OTA MUST NOT be described as signed firmware by itself. Firmware image
signature verification, Secure Boot, and anti-rollback by security version are
out of scope for this change unless a future design explicitly adds them.

The production OTA guidance MUST NOT imply that rollback is automatic just
because HTTPS OTA is used. It MUST document the required partition layout
(`ota_0`, `ota_1`, and `otadata`), rollback bootloader configuration where
available, first-boot self-test, and marking the application valid only after
the self-test succeeds.

**Scenarios:**

```gherkin
Scenario: OTA skill separates development and production flows
  Given skills/esp32-ota/SKILL.md exists
  When an agent reads the skill
  Then it documents ArduinoOTA as a dev/LAN flow
  And it documents HTTPS OTA as the production/security flow
  And it warns that ArduinoOTA is not sufficient for untrusted networks

Scenario: Production OTA documents A/B rollback requirements
  Given skills/esp32-ota/SKILL.md exists
  When the production OTA section is inspected
  Then it mentions ota_0 and ota_1 app partitions
  And it mentions an otadata partition
  And it mentions CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE or the equivalent rollback bootloader configuration for the active core
  And it requires a first-boot self-test before accepting the new firmware
  And it mentions esp_ota_mark_app_valid_cancel_rollback or the Arduino-accessible equivalent

Scenario: Rollback capability is not assumed from the partition table
  Given the project uses the precompiled Arduino-ESP32 core and bootloader
  When production rollback guidance is documented
  Then it states that ota_0, ota_1, and otadata are necessary but not sufficient
  And it requires verifying that the flashed bootloader supports app rollback
  And it does not claim automatic rollback when support cannot be demonstrated
  And it does not suggest enabling bootloader rollback from application build flags

Scenario: OTA snippets are compile-verifiable
  Given the OTA skill includes one or more Arduino snippets or sketches
  When the snippets are converted into minimal sketches for validation
  Then each minimal sketch SHALL compile with FQBN esp32:esp32:esp32 on Arduino-ESP32 core 2.0.18
  And validation MUST use arduino-cli compile, not arduino-cli upload
```

### REQ-002: Skill `esp32-displays`

The repository MUST add `skills/esp32-displays/SKILL.md` as a curated display
skill covering OLED/SSD1306, NeoPixel, and GFX-style drawing patterns. TFT MAY
be mentioned as related display technology, but it is not implemented or covered
by this change. The skill MUST use original Adafruit APIs as the baseline and
MUST clearly state that
Acebott `ACB_Adafruit_*` wrappers are treated as precompiled wrappers that are
expected to mirror the public Adafruit API unless Acebott changed them.

The skill MUST NOT require extracting or inspecting `ACB_SmartCar_V2.zip` as part
of this change. Exact wrapper inspection MAY be left as future verification work.

**Scenarios:**

```gherkin
Scenario: Display skill uses Adafruit APIs as the stable baseline
  Given skills/esp32-displays/SKILL.md exists
  When an agent reads the OLED and NeoPixel examples
  Then the examples use Adafruit_SSD1306, Adafruit_GFX, or Adafruit_NeoPixel APIs
  And the examples avoid undocumented ACB-only calls

Scenario: Display skill documents the ACB wrapper limitation
  Given skills/esp32-displays/SKILL.md exists
  When the compatibility notes are inspected
  Then the skill states that ACB_Adafruit_* wrappers are precompiled Acebott wrappers
  And it states that the Adafruit API is the documented source of truth for this skill
  And it warns that exact wrapper fidelity is unverified unless the bundle is inspected

Scenario: Display skill preserves core 2.0.18 compatibility
  Given skills/esp32-displays/SKILL.md exists
  When compatibility notes are inspected
  Then the skill warns not to upgrade the QD001 project to Arduino-ESP32 core 3.x
  And the warning mentions binary compatibility risk with Acebott precompiled libraries
```

### REQ-003: Skill `esp32-ble`

The repository MUST add `skills/esp32-ble/SKILL.md` as a curated BLE skill for
Arduino-ESP32 core 2.0.18. The skill MUST use native `BLEDevice` as the default
baseline because it does not require adding an external library. NimBLE MAY be
documented as an alternative for lower RAM/flash usage, but it MUST be marked as
an external dependency that requires explicit user confirmation before install.

**Scenarios:**

```gherkin
Scenario: BLE skill defaults to native BLEDevice
  Given skills/esp32-ble/SKILL.md exists
  When the quick-start example is inspected
  Then it uses BLEDevice from the Arduino-ESP32 core
  And it does not require installing NimBLE to run the baseline example

Scenario: BLE skill documents NimBLE as an explicit opt-in alternative
  Given skills/esp32-ble/SKILL.md exists
  When the alternatives section is inspected
  Then NimBLE is described as lower-memory external-library option
  And the skill states that installing NimBLE requires explicit user confirmation
  And it does not instruct the agent to auto-install the dependency

Scenario: BLE skill documents WiFi coexistence risks
  Given the QD001 already uses WiFi AP/TCP control
  When the BLE skill is inspected
  Then it warns that BLE and WiFi share the ESP32 2.4 GHz radio
  And it recommends validating BLE behavior with the active WiFi control workload
```

### REQ-004: mTLS section in `esp32-connectivity`

`skills/esp32-connectivity/SKILL.md` MUST add a mutual TLS section that extends
the existing TLS guidance. The section MUST show the client-side certificate
chain pattern using CA certificate, client certificate, and client private key.
It MUST preserve the existing security stance that `setInsecure()` is dev-only
and MUST NOT present certificate-less TLS as production-safe.

**Scenarios:**

```gherkin
Scenario: Connectivity skill documents mTLS client credentials
  Given skills/esp32-connectivity/SKILL.md exists
  When the TLS section is inspected
  Then it contains a subsection for mTLS or mutual TLS
  And it mentions setCACert
  And it mentions setCertificate
  And it mentions setPrivateKey

Scenario: mTLS section documents storage and size constraints
  Given the mTLS subsection exists
  When the gotchas are inspected
  Then it warns that CA, client certificate, and private key consume flash/PROGMEM
  And it instructs developers not to hardcode real private keys in tracked example code

Scenario: mTLS does not weaken existing TLS guidance
  Given skills/esp32-connectivity/SKILL.md contains existing TLS warnings
  When the mTLS section is added
  Then setInsecure remains documented as dev-only
  And production examples continue to validate certificates
```

### REQ-005: Line-follower calibration utility

The change MUST add a calibration utility for the QD001 line-follower sensors.
The utility MUST be an interactive serial Arduino sketch that samples the analog
line-tracking sensors, computes per-sensor thresholds, and persists them in NVS
using `Preferences` namespace `qd001`.

The utility MUST preserve safe defaults: if calibration values are absent, the
runtime guidance SHALL fall back to the current documented defaults
(`Black_Line = 2000`, `Off_Road = 4000`).

**Scenarios:**

```gherkin
Scenario: Calibration sketch guides per-sensor sampling
  Given the calibration utility exists
  When a developer opens the sketch
  Then it documents the QD001 analog line sensor pins Left=35, Middle=36, Right=39
  And it guides the user through black and white surface sampling over Serial
  And it averages multiple analogRead samples per measurement

Scenario: Calibration utility persists thresholds in NVS
  Given the calibration sketch has completed sampling
  When it stores calibrated values
  Then it uses Preferences namespace "qd001"
  And it stores per-sensor threshold keys for left, middle, and right
  And it stores or documents the off-road threshold behavior
  And it writes a completion marker named line_cal_v only after all thresholds are valid

Scenario: Calibration rejects invalid or partial measurements
  Given the operator measures black and white surfaces for all three sensors
  When any sensor has insufficient contrast between black and white samples
  Then the sketch reports the failing sensor and measured contrast
  And it does not write any threshold keys
  And it does not write line_cal_v

Scenario: Calibration uses safe numeric types while sampling
  Given the calibration sketch averages multiple ADC samples
  When it accumulates raw readings
  Then the accumulator type is at least uint32_t
  And only final averaged thresholds are stored as uint16_t-compatible values

Scenario: Runtime guidance falls back safely when NVS is empty
  Given no qd001 calibration values exist in NVS
  When the runtime loading snippet reads thresholds
  Then it uses 2000 as the default line threshold
  And it uses 4000 as the default off-road threshold
  And it uses NVS values only if line_cal_v is present and valid
  And it does not fail boot because calibration has not run

Scenario: Calibration utility is hardware-validated
  Given the calibration sketch is implemented
  When validation runs
  Then it MUST compile with FQBN esp32:esp32:esp32
  And hardware validation SHOULD include flash and serial monitor confirmation before marking the task complete
```

### REQ-006: Skills README index update

`skills/README.md` MUST be updated after the new skills are added. The active
skill count MUST become 14. OTA, Displays, BLE, and mTLS MUST no longer be
listed as uncovered gaps. ULP MUST remain visible as an explicit out-of-scope
gap unless a future change implements it.

**Scenarios:**

```gherkin
Scenario: README lists the three new skills
  Given skills/README.md is updated
  When the Active Skills section is inspected
  Then it lists esp32-ota
  And it lists esp32-displays
  And it lists esp32-ble
  And the total curated skill count is 14

Scenario: README gap status matches this change scope
  Given skills/README.md is updated
  When the Gaps restantes section is inspected
  Then OTA is not listed as an uncovered gap
  And OLED / NeoPixel / displays is not listed as an uncovered gap
  And BLE is not listed as an uncovered gap
  And mTLS is not listed as an uncovered gap
  And ULP remains listed as out of scope or future work
```

### REQ-007: Security-first dependency handling

All new or modified skills MUST preserve the repository's security-first skill
curation policy. External libraries MAY be documented, but agents MUST NOT be
instructed to install dependencies automatically without explicit user
confirmation.

**Scenarios:**

```gherkin
Scenario: External dependency instructions require confirmation
  Given a new skill mentions an external Arduino library
  When the install instructions are inspected
  Then the skill states that installation requires explicit user confirmation
  And it does not tell an agent to install the dependency automatically

Scenario: Dependency preflight gates compile validation
  Given an example depends on an external Arduino library
  When validation starts
  Then the task flow first detects whether the exact library is already installed
  And it records the detected version when available
  And it compiles the target only if dependencies are available
  And if dependencies are missing, it stops that target and requests explicit authorization
  And it does not mark the target as compile-validated by assumption

Scenario: Examples avoid real secrets
  Given a skill includes certificates, keys, WiFi credentials, or OTA passwords
  When the example code is inspected
  Then examples use placeholders or clearly fake values
  And the skill warns not to commit real private keys or production credentials
```

## Non-Goals

- This change SHALL NOT extract or reverse-engineer `ACB_SmartCar_V2.zip`.
- This change SHALL NOT implement LoRa.
- This change SHALL NOT implement OTA over BLE.
- This change SHALL NOT implement ULP coprocessor workflows.
- This change SHALL NOT implement TFT examples or claim TFT coverage.
- This change SHALL NOT implement firmware image signing, Secure Boot, or
  anti-rollback by security version.
- This change SHALL NOT upgrade Arduino-ESP32 beyond core 2.0.18.
- This change SHALL NOT use `arduino-cli upload` for validation.

## Acceptance Gate

- Markdown artifacts MUST be readable and internally consistent with
  `proposal.md`.
- Firmware snippets and sketches MUST be validated by compile at minimum.
- Flash/serial validation SHOULD be done for the calibration utility before
  claiming hardware behavior.
- Any dependency installation MUST be explicitly approved by the user before it
  is executed.
