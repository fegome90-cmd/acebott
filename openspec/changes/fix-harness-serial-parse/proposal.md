# Proposal — fix-harness-serial-parse

> SDD proposal phase. Intent, scope, approach for a bug fix.

## Change

`fix-harness-serial-parse` — Remove the duplicated `proc.on(...)`
tail block in `harness/src/lib/serial.ts` that causes a ParseError and
prevents the `acebott-harness` Pi extension from loading.

## Motivation

The harness extension is currently un-loadable. Every Pi session logs
the ParseError at boot, and every subagent dispatch fails before the
agent can run. This blocks:

- The apply phase of `add-robot-skills-tool` (needs subagents + `/reload`)
- Any future subagent-based workflow in this repo
- Live use of `robot_detect` / `robot_health` from the agent

The fix is a pure deletion of dead, duplicated code.

## Scope

### In scope

- Delete lines 126–135 of `harness/src/lib/serial.ts` (the dangling
  duplicate of the `proc.on("error")` / `proc.on("close")` block)
- Verify parse + boot + tests

### Out of scope

- Refactoring `readSerial` internals
- Any change to `detect.ts`, `health.ts`, `index.ts`, or any other file
- The `add-robot-skills-tool` change (separate)

## Approach

Single surgical edit: remove the duplicated tail block. The live
handlers (inside the Promise, before `finish` resolves) already cover
both the `"error"` and `"close"` process events. No new code.

## Rollback Plan

Trivial: `git revert` the single commit. The deleted block was never
reachable, so removal cannot cause a regression.

## Success Criteria

1. `tsc --noEmit` in harness/ exits 0
2. Pi boots with no extension load error (no `-ne` needed)
3. `pnpm test` passes (no regression in serial tests)
4. A `delegate` subagent starts successfully (extension loads)

## Next Steps

Proceed directly to **tasks** (spec/design condensed for a bug fix of
this size — see tasks.md).
