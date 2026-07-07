# Explore — fix-harness-serial-parse

> SDD explore phase. Bug-fix scope: minimal investigation.

## Context

The installed Pi extension `acebott-harness` fails to load on every Pi boot:

```
Error: Failed to load extension ".../acebott-harness/src/index.ts":
Failed to load extension: ParseError: Unexpected token
  harness/src/lib/serial.ts:116:1
Hint: Start without extensions using "pi -ne".
```

This blocks **all** subagent workflows (delegate/worker/scout cannot
boot) and prevents `/reload` from picking up any harness change —
including the upcoming `robot_skills` tool from `add-robot-skills-tool`.

## Root Cause

`harness/src/lib/serial.ts` has a duplicated block. The function
`readSerial` closes correctly at line 124 (`});`), but lines 126–135
repeat the `proc.on("error", ...)` / `proc.on("close", ...)` block
**outside** the function, after the closing brace. This dangling code is
unreachable and syntactically invalid at module top level → ParseError.

The correct block already exists **inside** the function (around lines
113–121, before `finish` resolves). The tail duplicate is the bug.

## Fix

Delete lines 126–135 (the duplicated tail block) from
`harness/src/lib/serial.ts`. No logic change — the live handlers inside
the Promise are the ones that actually run.

## Verification

1. `node --check harness/src/lib/serial.ts` (or `tsc --noEmit`) → exit 0
2. Start Pi (no `-ne`) → no extension load error
3. `pnpm test` in harness/ → existing serial tests still pass
4. Boot a subagent (`delegate`) → it starts (confirms extension loads)

## Scope

- In: remove the duplicated tail block in `serial.ts` (≈10 lines)
- Out: any refactor of serial logic, any new feature, any other file

## Risk

Very low. The deleted code is unreachable (outside any function) and is
a verbatim duplicate of code that already runs inside `readSerial`.
Removing it changes no behavior.
