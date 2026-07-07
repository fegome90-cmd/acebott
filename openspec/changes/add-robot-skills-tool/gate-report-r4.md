# SDD Gate Report (Round 4 — Independent Subagent Run) — `add-robot-skills-tool`

> Run 99a46789 + 5241d60d. 2/3 agents completed (structure, risk). Design agent
> timed out but produced one partial finding (DES-001) verified inline.
> Subagent runtime: WORKING (serial.ts fix confirmed — tsc --noEmit passes clean).

## Gate Decision

# 🟡 REVIEW — 1 high finding (StringEnum compile error), 3 medium

**Independent agents found real contract issues the prior 3 inline rounds
missed.** This is exactly why independent verification matters — fresh context
catches what the author's blind spots hide.

## Metrics

| Metric | Value |
|---|---|
| Agents Completed | 2/3 (structure ✅, risk ✅, design ⏱️ timed out) |
| Quorum Met | Yes (2 agents, determinable outcome) |
| Findings (this round) | 1 high, 3 medium, 7 low, 7 informational |
| Gate | **REVIEW** (high > 0 → per matrix) |
| Structural Audit | Skipped (no state/pipeline surfaces) |

## Round 4 Findings (Independent — from subagents)

### RISK-001 — HIGH — `StringEnum` is not a typebox 0.34 export (COMPILE ERROR)

- **Source**: risk agent (independent)
- **Artifact**: design.md Tool Contract (`StringEnum(["recommend","list","get"])`); tasks.md 2.1
- **Finding**: `StringEnum` does NOT exist in `@sinclair/typebox@0.34.49`. It's a
  recipe in the typebox README, not a built-in export. The only enum export is
  `Type.Enum()` which takes a TS enum object, not `string[]`. Following the
  contract literally → `tsc` compile error.
- **Evidence**: `grep -rn "StringEnum" node_modules/@sinclair/typebox/` → only in
  `readme.md:992` as a user-defined helper recipe. Existing tools (detect.ts,
  health.ts) use `Type.String`/`Type.Boolean` only — no enum params at all.
- **Fix**: Define a local `StringEnum` helper in `tools/skills.ts`:
  `const StringEnum = <T extends string[]>(v: T) => Type.Unsafe<T[number]>({ type: "string", enum: v })`
  OR use `Type.Union([Type.Literal("recommend"), ...])`.

### DES-001 — MEDIUM — `readonly RecommendArea[]` vs `RecommendArea[]` type mismatch (COMPILE ERROR)

- **Source**: design agent (partial, verified inline)
- **Artifact**: design.md Module Contract — `areasForName` return type vs `SkillEntry.areas`
- **Finding**: `areasForName()` returns `readonly RecommendArea[]` but
  `SkillEntry.areas` is `RecommendArea[]` (mutable). `scanSkills` assigns
  `areasForName(name)` to `entry.areas` → TS strict mode error: cannot assign
  `readonly` to mutable.
- **Evidence**: design.md line 402: `areasForName(name): readonly RecommendArea[]`;
  design.md line 370: `areas: RecommendArea[]` (no readonly).
- **Fix**: Either make `SkillEntry.areas` also `readonly RecommendArea[]`, or
  have `areasForName` return a mutable copy (`[...]`).

### RISK-002 — MEDIUM — `safeErrorMessage()` undefined, never tasked, untested

- **Source**: risk agent (independent)
- **Artifact**: design.md ADR-006 + action dispatch; tasks.md 1.1, 2.1
- **Finding**: The catch-all safety net depends on `safeErrorMessage()` which
  (a) doesn't exist in `harness/src/`, (b) has no creation task, (c) has no
  signature, (d) has no sanitization rule. The existing convention (detect.ts)
  is pass-through: `err instanceof Error ? err.message : String(err)` — no
  sanitization, full paths leak in Node FS errors.
- **Evidence**: `grep -rn "safeErrorMessage" harness/src/` → no matches.
  detect.ts uses raw `err.message` pass-through.
- **Fix**: Either define `safeErrorMessage()` with a pinned rule + unit test,
  OR relax ADR-006 to match the existing pass-through convention and drop the
  "avoid leaking internals" claim.

### RISK-003 — MEDIUM — Flash skill has quoted frontmatter + nested keys; no fixture covers this

- **Source**: risk agent (independent)
- **Artifact**: design.md OQ-3/flashEntry; spec.md REQ-005; tasks.md fixtures
- **Finding**: The ONE external skill (`acebott-esp32-flash`) uses a
  **double-quoted** `description:` and has nested `metadata:`/`triggers:` keys.
  The hand-rolled parser does line-prefix extraction with no quote stripping →
  `entry.description` will contain literal `"` characters. No fixture (3.1–3.10)
  uses quoting or nested blocks.
- **Evidence**: Flash frontmatter: `description: "Use when flashing..."` (quoted).
  All 11 repo skills are unquoted single-line. `malformed` fixture is garbage, not quoted.
- **Fix**: Add a fixture mirroring the flash shape (quoted description + nested
  block) and assert description is clean (strip matching `"`/`'`), OR document
  quoted-desc as accepted degradation in REQ-005.

### STR-001..007 — LOW/INFO (structure agent, independent)

- **STR-001** (LOW): explore.md tree shows 8 skills but says 11 (cosmetic — explore is superseded)
- **STR-002** (LOW): manifest omits 3 new fixtures (README.md, notes/, foo/) added in tasks 3.7-3.9
- **STR-003** (LOW): flashEntry location ambiguous between tools/skills.ts and lib/skills-index.ts
- **STR-004** (LOW): error text "No skills found in <path>" — design/tasks drop the `<path>`
- **STR-005** (LOW): duplicate skill name handling — design says "should be tested" but no fixture/test
- **STR-006** (INFO): flashEntry throw-on-read-failure untested
- **STR-007** (INFO): explore's "log a warning" for dupes silently dropped

### RISK-004..010 — LOW/INFO (risk agent, independent)

- **RISK-004** (LOW): No factory composition smoke test (bad import kills all 3 tools)
- **RISK-005** (LOW): Prerequisite serial.ts — **RESOLVED** (tsc --noEmit passes, serial.ts clean)
- **RISK-006** (INFO): NFR-001 verified — zero new deps ✓
- **RISK-007** (INFO): Scope tight, additive, read-only, clean rollback ✓
- **RISK-008** (INFO): Re-scan perf non-issue at 11 skills (< 5ms) ✓
- **RISK-009** (INFO): Security — no traversal (parsed name match), enum-constrained ✓
- **RISK-010** (INFO): Task feasibility HIGH, phase deps correct ✓

## Positive observations from independent agents

- **Structure agent**: "structurally strong... scenario coverage is STRONG...
  naming consistency PASS... count accuracy PASS... Recommendation: PASS"
- **Risk agent**: "fundamentally sound and low-risk overall... none of the
  findings invalidate the architecture... GO WITH CONDITIONS"

## Aggregated Gate Decision

Per matrix: **high > 0 → REVIEW**. RISK-001 (StringEnum) is high.

All 4 actionable findings (1 high + 3 medium) are small, well-bounded fixes
that do NOT require architectural changes. They are implementation-contract
corrections, not design flaws.
