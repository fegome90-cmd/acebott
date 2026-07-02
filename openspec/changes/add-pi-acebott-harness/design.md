# Design — pi-acebott-harness

> SDD design phase. Resolves open questions from spec, defines technical
> contracts, and documents architecture decisions.

## Open Questions Resolved

### OQ-1: USB chip detection strategy (resolves RISK-01)

**Decision**: Use `ioreg -r -c IOUSBHostDevice -l` as primary, with
`system_profiler SPUSBDataType -json` as fallback.

**Rationale**: `ioreg` is more stable across macOS versions and faster.
`system_profiler` JSON format has changed across major releases. We
parse `ioreg` output for `idVendor` and `idProduct` fields, filtering
for the CH340 IDs (0x1A86 / 0x7523).

**Contract** (`lib/usb.ts`):

```typescript
interface ChipInfo {
  vendor: string;        // "WCH" for 0x1A86
  vendorId: string;      // "0x1A86"
  productId: string;     // "0x7523"
}

async function detectChip(): Promise<ChipInfo | null>;
// Returns null if no CH340 detected, throws on ioreg failure
```

Detection logic:

1. Run `ioreg -r -c IOUSBHostDevice -l`
2. Parse for devices with `idVendor == 6790` (0x1A86)
3. If found, map to ChipInfo
4. Fallback: `system_profiler SPUSBDataType -json` if ioreg yields nothing

### OQ-2: Serial readiness after flash (resolves RISK-03)

**Decision**: Poll for first JSON line, with hard timeout of 10s.

**Rationale**: A fixed delay (e.g., 3s) wastes time when the robot is
fast and fails silently when it's slow. Polling for the first `{"t":`
prefix detects actual readiness.

**Contract** (`lib/serial.ts`):

```typescript
interface SerialReadOptions {
  port: string;
  baud: number;          // always 115200
  timeoutMs: number;     // default 10000
  signal?: AbortSignal;
  linePredicate?: (line: string) => boolean;  // default: starts with "{"
}

async function readSerial(
  opts: SerialReadOptions
): Promise<string[]>;
// Returns collected lines. Empty array on timeout.
```

Logic:

1. Open serial via `uv run --with pyserial python -c "..."`
2. Read lines, buffer partial lines
3. Collect lines matching predicate (default: starts with `{`)
4. Stop when: timeoutMs elapsed OR signal.aborted OR "health" line seen
5. Return collected lines

### OQ-3: Motors test safety (resolves RISK-02)

**Decision**: Motors test does NOT move the robot. It reports "ready"
by checking that `ACB_SmartCar.Init()` succeeds and motor objects respond,
without issuing a movement command.

**Rationale**: A health check that launches the robot off a desk is a
liability. The motors are validated indirectly:

- `ACB_SmartCar.Init()` succeeding confirms I2C/driver communication
- A separate `robot_move` tool (future change) will handle actual movement
  with explicit user intent

**Firmware contract** (`health_check.ino` motors section):

```cpp
// motors test — confirm Init succeeds, do NOT move
ACB_SmartCar.Init();
Serial.println("{\"t\":\"motors\",\"fl\":\"ok\",\"fr\":\"ok\",\"bl\":\"ok\",\"br\":\"ok\"}");
```

The "ok" values reflect that Init completed, not that wheels turned.
This is documented in the firmware comments and the health report
includes a note: `motors.tested: "init_only"`.

## Architecture Decisions

### ADR-001: Monorepo subdirectory, not separate repo

**Context**: User requested the harness live inside `acebott/`.
**Decision**: `acebott/harness/` with its own `package.json`.
**Consequences**: Shared git history with the project. Can be split
to its own repo later via `git filter-branch` if needed.

### ADR-002: pnpm workspace (single package)

**Context**: Security decision to avoid npm.
**Decision**: Use pnpm with a single package (no workspace needed yet).
If we add more sub-packages later, convert to pnpm workspace.
**Consequences**: `pnpm install` and `pnpm test` work standalone.

### ADR-003: Symlink for local install

**Context**: No publish until tested.
**Decision**:

```bash
ln -s ~/Developer/acebott/harness ~/.pi/agent/extensions/acebott-harness
```

**Consequences**:

- Hot reload via Pi `/reload` during development
- No build step needed for install (Pi loads .ts directly via tsx)
- Removal: `rm ~/.pi/agent/extensions/acebott-harness`

### ADR-004: vitest for tests

**Context**: Need fast unit tests with mocking.
**Decision**: vitest (not jest) — native ESM, fast, good TypeScript
support, integrates with pnpm.
**Consequences**: `pnpm test` runs vitest. Mocks via `vi.mock()`.

### ADR-005: esptool invocation via child_process

**Context**: The bundled esptool is a native binary, not a library.
**Decision**: Spawn it via `child_process.spawn` with proper signal
forwarding and output capture.
**Contract** (`lib/esptool.ts`):

```typescript
interface FlashOptions {
  sketchPath: string;        // path to .ino
  buildPath: string;         // output dir
  port: string;
  signal?: AbortSignal;
  onUpdate?: (progress: string) => void;
}

async function flashSketch(opts: FlashOptions): Promise<void>;
// Throws on compile or flash failure. Respects signal.aborted.
```

Hardcoded invariants (no override):

- `--baud 115200` (always)
- esptool path: `/Applications/ACECode.app/Contents/extraFiles-mac/compile/burner/esptool`
- offsets: 0x1000, 0x8000, 0xe000, 0x10000

### ADR-006: JSON-lines serial protocol

**Context**: Firmware must emit parseable health data.
**Decision**: One JSON object per line, prefixed with `{"t":"<type>",...}`.
**Consequences**:

- Parser splits on newlines, JSON.parse each line
- Malformed lines skipped (REQ-003 scenario)
- Terminal `{"t":"health","result":"pass|fail"}` signals completion

## Tool Contracts (final)

### `robot_detect`

```typescript
parameters: Type.Object({
  port: Type.Optional(Type.String({
    description: "Specific port to check. Auto-detects if omitted."
  })),
}),
// Returns: { content: [{type:"text", text: <summary>}], details: <DetectResult> }

interface DetectResult {
  connected: boolean;
  port: string | null;
  chip: ChipInfo | null;
  acecodeRunning: boolean;
  portBusy: boolean;
  firmwareHint: string;   // "unknown" unless probed
}
```

### `robot_health`

```typescript
parameters: Type.Object({
  skipFlash: Type.Optional(Type.Boolean({
    description: "Skip compile+flash, only read serial. Default false.",
    default: false,
  })),
}),
// Returns: { content: [{type:"text", text: <summary>}], details: <HealthReport> }

interface HealthReport {
  leds: { left: string; right: string };
  buzzer: string;
  motors: { fl: string; fr: string; bl: string; br: string; tested: string };
  ultrasonic: { distance_cm: number | null };
  tracking: { left: number | null; middle: number | null; right: number | null };
  ir: { code: string };
  result: "pass" | "fail" | "timeout";
}
```

## Constants (`lib/constants.ts`)

```typescript
export const FQBN = "esp32:esp32:esp32";
export const BAUD = 115200;
export const ESPTOOL_PATH =
  "/Applications/ACECode.app/Contents/extraFiles-mac/compile/burner/esptool";
export const FLASH_OFFSETS = {
  bootloader: 0x1000,
  partitions: 0x8000,
  boot_app0: 0xe000,
  firmware: 0x10000,
} as const;
export const CHIP = {
  vendorId: 0x1A86,
  productId: 0x7523,
  vendorName: "WCH",
} as const;
export const PINS = {
  motors: "ACB_SmartCar_V2",
  ultrasonicTrig: 13,
  ultrasonicEcho: 14,
  servo: 25,
  ledLeft: 12,
  ledRight: 2,
  buzzer: 33,
  irReceiver: 4,
  trackingLeft: 35,
  trackingMiddle: 36,
  trackingRight: 39,
} as const;
export const AP = {
  ssid: "ESP32-Car",
  password: "12345678",
} as const;
export const SERIAL_TIMEOUT_MS = 10000;
```

## File Manifest

```
harness/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── .gitignore
├── src/
│   ├── index.ts                  ← extension factory
│   ├── tools/
│   │   ├── detect.ts
│   │   └── health.ts
│   └── lib/
│       ├── constants.ts
│       ├── usb.ts
│       ├── esptool.ts
│       ├── serial.ts
│       └── arduino-cli.ts
├── firmware/
│   └── health_check/
│       └── health_check.ino
├── skill/
│   └── SKILL.md
└── tests/
    ├── unit/
    │   ├── detect.test.ts
    │   ├── health.test.ts
    │   └── parsers.test.ts
    └── integration/
        └── hardware.test.ts
```

## Next Steps

Proceed to **tasks** phase to break this into implementable units.
Gate on design+tasks before apply.
