# Spec — pi-acebott-harness

> SDD spec phase. Formal requirements with Given/When/Then scenarios.
> References: proposal.md, explore.md

## Requirements

### REQ-001: Package scaffold

The harness MUST be a pnpm-managed TypeScript package inside
`acebott/harness/`, importable as a Pi extension.

**Scenarios:**

```gherkin
Scenario: Package installs with pnpm
  Given a clean checkout of the acebott repo
  When the developer runs `pnpm install` in harness/
  Then node_modules is populated
  And `@earendil-works/pi-coding-agent` is resolvable
  And `@sinclair/typebox` is resolvable

Scenario: TypeScript compiles clean
  Given the package is installed
  When the developer runs `pnpm build`
  Then `tsc --noEmit` exits 0
  And no type errors are reported

Scenario: Extension is discoverable via symlink
  Given the harness is built
  When the developer symlinks harness/ to ~/.pi/agent/extensions/acebott-harness
  And starts Pi with /reload
  Then robot_detect and robot_health appear in /tools
```

### REQ-002: `robot_detect` tool — robot presence

The tool MUST detect whether an Acebott QD001 is connected and return
structured information about the connection.

**Scenarios:**

```gherkin
Scenario: Robot connected, port free, ACECode not running
  Given the QD001 is plugged in at /dev/cu.usbserial-110
  And no process holds the port
  And ACECode is not running
  When the agent calls robot_detect
  Then the result contains connected: true
  And port: "/dev/cu.usbserial-110"
  And chip.vendorId: "0x1A86"
  And chip.productId: "0x7523"
  And acecodeRunning: false
  And portBusy: false

Scenario: Robot not connected
  Given no USB-serial device is present
  When the agent calls robot_detect
  Then the result contains connected: false
  And port: null
  And the result text explains "No Acebott detected"

Scenario: ACECode is running (port may be held)
  Given the QD001 is connected
  And the ACECode process is alive
  When the agent calls robot_detect
  Then the result contains acecodeRunning: true
  And portBusy reflects whether ACECode holds the port
  And the result text warns that ACECode should be killed before flash

Scenario: Custom port override
  Given the agent passes port: "/dev/cu.usbserial-999"
  When the agent calls robot_detect with that port
  Then detection checks that specific port
  And does not scan other ports
```

### REQ-003: `robot_health` tool — full self-test

The tool MUST flash a self-test firmware and return a structured health
report parsed from serial output.

**Scenarios:**

```gherkin
Scenario: Healthy robot, full self-test
  Given the QD001 is connected and port is free
  And ACECode is not running
  When the agent calls robot_health
  Then the tool compiles firmware/health_check/health_check.ino
  And flashes it via esptool bundled at 115200 baud
  And reads serial output for up to 10 seconds
  And returns a parsed report with:
    | field      | value          |
    | leds.left  | "ok"           |
    | leds.right | "ok"           |
    | buzzer     | "ok"           |
    | motors.fl  | "ok"           |
    | motors.fr  | "ok"           |
    | motors.bl  | "ok"           |
    | motors.br  | "ok"           |
    | ultrasonic.distance_cm | <number> |
    | tracking.left | <number>    |
    | tracking.middle | <number>  |
    | tracking.right | <number>   |
    | ir.code    | "none" or hex  |
    | result     | "pass"         |

Scenario: ACECode is running — interactive block
  Given the QD001 is connected
  And ACECode process is alive
  When the agent calls robot_health
  Then the tool calls ctx.ui.confirm asking to kill ACECode
  And if the user declines, the tool returns an error WITHOUT flashing
  And if the user accepts, the tool kills ACECode then proceeds

Scenario: skipFlash option
  Given health_check.ino is already flashed on the robot
  When the agent calls robot_health with skipFlash: true
  Then the tool does NOT compile or flash
  And only reads serial output and parses the report

Scenario: Serial timeout
  Given the robot is flashed but produces no serial output
  When the agent calls robot_health
  And 10 seconds pass with no valid JSON lines
  Then the tool returns result: "timeout"
  And the text explains "No serial output received within timeout"

Scenario: Malformed serial line
  Given the robot emits a line that is not valid JSON
  When the parser processes serial output
  Then the malformed line is skipped (not fatal)
  And parsing continues with subsequent lines
```

### REQ-004: Guardrails

The tools MUST enforce safety invariants, never allowing dangerous
operations silently.

**Scenarios:**

```gherkin
Scenario: Flash blocked when ACECode running without consent
  Given ACECode process is alive
  When robot_health attempts to flash
  Then the flash does NOT proceed
  And the tool returns an error mentioning ACECode

Scenario: Baud rate always 115200
  Given any flash operation via the harness
  When esptool is invoked
  Then the --baud flag is exactly 115200
  And no parameter can override this to a higher value

Scenario: Cancellation respected
  Given a long-running health check
  When the agent aborts the tool call (signal.aborted)
  Then the tool stops reading serial
  And returns a "Cancelled" text result
  And does not throw
```

### REQ-005: Firmware `health_check.ino`

The bundled firmware MUST test all QD001 peripherals and emit
parseable JSON-lines output.

**Scenarios:**

```gherkin
Scenario: Firmware emits complete health report
  Given health_check.ino is flashed and running
  When the serial monitor reads output
  Then the following JSON lines appear (order may vary):
    | type       | required fields                          |
    | "leds"     | left, right                              |
    | "buzzer"   | status                                   |
    | "motors"   | fl, fr, bl, br                           |
    | "ultrasonic"| distance_cm                             |
    | "tracking" | left, middle, right                     |
    | "ir"       | code                                     |
    | "health"   | result ("pass" or "fail")               |

Scenario: Firmware uses correct pins
  Given the firmware source
  When inspected
  Then it uses the pin map from the wiki:
    motors via ACB_SmartCar_V2.Init()
    ultrasonic trig=13 echo=14
    servo=25
    LEDs=12,2
    buzzer=33
    IR=4
    tracking=35,36,39
```

### REQ-006: Unit tests (vitest, mocked)

The harness MUST ship with unit tests covering tool registration,
parsing, and error paths — all mocked, no hardware required.

**Scenarios:**

```gherkin
Scenario: Tests pass without hardware
  Given no robot is connected
  When the developer runs `pnpm test`
  Then all unit tests pass
  And no test attempts to access /dev/cu.usbserial-*

Scenario: Parsers tested independently
  Given sample serial output fixtures
  When the parser unit tests run
  Then valid JSON lines parse to expected objects
  And malformed lines are skipped without throwing
  And timeout is detected correctly
```

### REQ-007: Integration tests (opt-in)

The harness MUST include integration tests that run against real
hardware, gated behind an environment variable.

**Scenarios:**

```gherkin
Scenario: Integration tests skipped by default
  Given the ACEBOTT_HW env var is not set
  When the developer runs `pnpm test`
  Then integration tests are skipped
  And a message explains how to enable them

Scenario: Integration tests run with hardware
  Given the QD001 is connected
  And ACEBOTT_HW=1 is set
  When the developer runs `pnpm test`
  Then robot_detect returns connected: true
  And robot_health returns a parsed report
```

## Non-Functional Requirements

### NFR-001: No npm publish

The package MUST NOT be published to any registry in this change.
Installation is local via symlink only.

### NFR-002: macOS only

Detection uses `system_profiler` and `/dev/cu.usbserial-*` conventions.
Windows/Linux support is out of scope.

### NFR-003: No side effects on existing setup

The harness is additive. Removing the symlink MUST restore Pi to its
previous state with no residual effects.

### NFR-004: Error paths return text, never throw

All tool execute functions MUST catch errors and return them as
`{ content: [{type:"text", text:"Error: ..."}] }`. Throwing crashes Pi.

## Open Questions (deferred to design)

1. Exact structure of `lib/usb.ts` — `system_profiler SPUSBDataType -json`
   parsing vs `ioreg`. Design phase decides.
2. How `robot_health` waits for serial readiness after flash — fixed
   delay vs polling for first JSON line. Design phase decides.
3. Whether `health_check.ino` motors test moves the robot (safety) or
   just reports ready state. Design phase decides.
