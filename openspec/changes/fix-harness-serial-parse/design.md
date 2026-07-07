# Design — fix-harness-serial-parse

> SDD design phase. Condensed for a single-file bug fix.

## Decision

Delete the duplicated tail block (lines 126–135) of
`harness/src/lib/serial.ts`. Keep the in-Promise handlers untouched.

## Why deletion is safe

The duplicated block sits at module top level, after `readSerial`'s
closing `});`. At that position it references `proc` and `finish`,
which are local to `readSerial` — the code is both unreachable and
syntactically invalid outside the function. The TypeScript parser
rejects the whole module before any of it runs, which is why the
extension fails to load.

The live, correct handlers are the ones inside the `new Promise(...)`
constructor, attached to `proc` before `finish` is first called. Those
remain after the fix.

## ADR-001: Surgical deletion over refactor

**Context**: The file has a clear duplication bug. A broader refactor of
`readSerial` is tempting but out of scope.

**Decision**: Delete only the duplicated tail. Do not restructure the
function, rename variables, or touch the Promise internals.

**Consequences**: Minimal blast radius. The fix is trivially reviewable
(one hunk, pure deletion). If a future change wants to refactor serial
reading, it can do so independently.

## Contract

No contract changes. `readSerial`'s public signature and return type
are unchanged:

```typescript
export function readSerial(opts: SerialReadOptions): Promise<string[]>;
```

## Next Steps

Proceed to **tasks**.
