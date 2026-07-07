# Tasks — fix-harness-serial-parse

> SDD tasks phase. Single-file bug fix.

## Phase 1: Fix

- [ ] 1.1 Open `harness/src/lib/serial.ts`, delete the duplicated tail
      block: the second `proc.on("error", () => { finish(collected); });`
      / `proc.on("close", () => { finish(collected); });` pair that
      appears AFTER `readSerial`'s closing `});` (lines ~126–135). The
      correct handlers inside the Promise (before `finish` resolves)
      MUST remain.
- [ ] 1.2 Confirm the file ends with the `readSerial` function's closing
      `}` followed by a single trailing newline. No dangling code.

## Phase 2: Verify

- [ ] 2.1 Run `pnpm build` (tsc --noEmit) in harness/ → exit 0, no errors
- [ ] 2.2 Run `pnpm test` in harness/ → all existing tests pass
- [ ] 2.3 Start Pi WITHOUT `-ne` → no ParseError in boot log, extension
      acebott-harness loads, `robot_detect` + `robot_health` in /tools
- [ ] 2.4 Dispatch a `delegate` subagent on a trivial task → it boots
      and completes (confirms extension load no longer blocks subagents)

## Implementation Note

This change is a prerequisite for the apply phase of
`add-robot-skills-tool`. Until `serial.ts` parses cleanly, no subagent
can boot and `/reload` cannot pick up the new `robot_skills` tool.

Implementation may proceed in this session or a follow-up; the fix is
small enough to apply directly once approved.
