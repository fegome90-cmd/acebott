# Spec — fix-harness-serial-parse

> SDD spec phase. Condensed for a single-file bug fix.

## Requirements

### REQ-001: Extension loads without parse error

The harness extension MUST load cleanly when Pi boots, with no
`-ne` flag and no ParseError in the boot log.

**Scenarios:**

```gherkin
Scenario: Pi boots and loads the extension
  Given harness/src/lib/serial.ts has the duplicated tail block removed
  When the developer starts Pi (no -ne flag)
  Then no ParseError is logged
  And the extension acebott-harness loads successfully
  And robot_detect and robot_health are registered (visible in /tools)

Scenario: TypeScript compiles clean
  Given the fix is applied
  When the developer runs pnpm build (tsc --noEmit)
  Then it exits 0
  And no type or parse errors are reported
```

### REQ-002: No behavioral regression

Removing the duplicated block MUST NOT change `readSerial` behavior,
because the deleted code was unreachable (outside any function).

**Scenarios:**

```gherkin
Scenario: Serial tests still pass
  Given the fix is applied
  When the developer runs pnpm test
  Then all existing serial unit tests pass
  And no test that passed before now fails

Scenario: Live handlers remain intact
  Given the fixed serial.ts
  When readSerial is inspected
  Then the proc.on("error") and proc.on("close") handlers still exist
    INSIDE the Promise constructor (before finish resolves)
  And there is no duplicate of those handlers at module top level
```

## Non-Functional Requirements

### NFR-001: Single-file, additive-safe change

Only `harness/src/lib/serial.ts` is touched. No other file is modified.

## Open Questions

None. The fix is mechanical.
