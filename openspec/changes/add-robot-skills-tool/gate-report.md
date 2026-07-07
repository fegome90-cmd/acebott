# SDD Gate Report — `add-robot-skills-tool`

> Skill: `sdd-gate-skill` v1.3.0 applied to the 5 planning artifacts.
> Mode: degraded inline (subagent runtime blocked by pre-existing harness
> bug — see Environment Note). The 3 gate roles (sdd-structure,
> sdd-design, sdd-risk) were executed inline against the artifacts and
> verified against the actual repo state.

## Gate Decision

# 🟡 REVIEW — contract fixes applied, pending independent re-run

**Round 1 (inline degraded):** 8 findings (STR/DES/RSK-*) — all resolved.
**Round 2 (human review):** 7 findings (H1–H3, M1–M4) — all resolved.
**Round 3 (veredicto):** 6 findings (getSkillByName unsafe lookup,
scanSkills directory filtering, recommendForArea non-deterministic,
flash flow ambiguity, fragile body extraction, missing catch-all) +
document inconsistencies — all resolved in artifacts. However, the gate
was never independently verified by fresh agents (subagents blocked by
ENV-001). No PASS claim until an independent gate runs.

**Current state:** all known findings across 3 rounds have been addressed
in the planning artifacts. The change is ready for an independent gate
re-run after `fix-harness-serial-parse` lands.

## Metrics

| Metric | Value |
|---|---|
| Findings Reported (R1 + R2 + R3) | 8 + 7 + 6 = 21 total |
| Findings Resolved | 21 / 21 |
| Agents Completed (R1) | 0/3 (inline degraded — ENV-001 blocked subagents) |
| Agents Completed (R2) | N/A (human review) |
| Agents Completed (R3) | N/A (human veredicto) |
| Gate | **REVIEW** (all findings resolved; independent re-run pending) |
| Structural Audit Run | No (no state/pipeline/gate surfaces touched) |
| Trifecta Reindex Performed | No (tool doesn't exist in code yet) |
| Prompt Injection Detected | No (Phase 0.5 scan clean) |

## Environment Note (why subagents failed)

The parallel `delegate` subagents (run `2d906863`) could not boot because
Pi fails to load the installed extension `acebott-harness`:

```
Error: Failed to load extension ".../acebott-harness/src/index.ts":
ParseError: Unexpected token
  harness/src/lib/serial.ts:116:1
```

Inspection of `harness/src/lib/serial.ts` lines 108–135 shows duplicated /
truncated code (the `proc.on("error"...)` / `proc.on("close"...)` block is
repeated after the closing brace of `readSerial`). This is a **pre-existing
bug in the harness, unrelated to this change**, but it must be fixed before
any subagent workflow (or `/reload` of the harness) can work. Flagged as
finding ENV-001 (informational, out of SDD-gate scope but blocking for the
follow-up apply session).

## Findings by Severity

| Severity | Count | IDs |
|---|---|---|
| critical | 0 | — |
| high | 2 | STR-001, RSK-001 |
| medium | 3 | DES-001, RSK-002, STR-002 |
| low | 2 | STR-003, DES-002 |
| informational | 1 | ENV-001 |

## Findings (deduplicated, evidence-backed)

### STR-001 — HIGH — spec.md scenario count is stale vs real filesystem

- **Artifact**: `spec.md`, REQ-002 scenario "List all skills in a populated directory"
- **Location**: "Then the result details.skills has 8 entries"
- **Finding**: The scenario hardcodes "8 entries", but the real `skills/`
  directory contains **11** skill subdirectories with valid `SKILL.md`
  files (`find skills -maxdepth 2 -name SKILL.md | wc -l` → 11). The
  hardcoded count will fail the moment the implementation agent runs the
  tool against the actual repo. The same stale "9 domain skills" /
  "8 entries" language appears in `explore.md` (Context), `proposal.md`
  (Motivation), and `design.md` (OQ-3 / NFR-002 "current 9 skills").
- **Evidence**: `ls skills/` returns 11 skill dirs (8 qd001/embedded/esp32
  originally listed + `esp32-connectivity`, `esp32-low-level-io`,
  `esp32-rtos-power`); spec.md REQ-002 literally says "has 8 entries".
- **Recommendation**: Either (a) rephrase scenarios to "N entries (matches
  current skill count)" so they don't hardcode a number, or (b) update all
  counts to 11 across the 4 artifacts. Option (a) is more robust because
  the count will keep growing.

### RSK-001 — HIGH — 3 real skills unmapped in AREA_TO_SKILL

- **Artifact**: `design.md`, ADR-002 / area mapping table; `explore.md` Finding 3
- **Location**: AREA_TO_SKILL table omits `esp32-connectivity`,
  `esp32-low-level-io`, `esp32-rtos-power`
- **Finding**: The 3 newest skills are thematically ESP32 skills but only
  `esp32-arduino-development` is mapped to area `esp32`. The 3 new ones
  have no area entry, so per REQ-006 they get `area: "other"`. This is
  arguably acceptable (the tool still lists them), but the artifact set
  never acknowledges this gap, and a user calling `recommend("esp32")`
  gets only one of four relevant skills. The artifact set should either
  (a) explicitly accept that granular esp32 sub-areas are deferred, or
  (b) extend the enum with `connectivity`, `low-level`, `rtos` areas.
- **Evidence**: `grep -E "esp32-connectivity|esp32-low-level|esp32-rtos"
  design.md explore.md proposal.md` → "NOT mentioned in any artifact".
  All 3 skills have valid `name:` + `description:` frontmatter.
- **Recommendation**: Add a short "Scope Note" to `design.md` ADR-002
  stating that `esp32-*` sub-skills are intentionally collapsed under
  `area: "other"` for this change, and that finer-grained esp32 areas
  are a future enhancement. This makes the behavior documented, not
  accidental.

### DES-001 — MEDIUM — `area` field type inconsistent between the two contracts

- **Artifact**: `design.md`, Tool Contract vs Module Contract
- **Location**: Tool Contract `SkillEntry.area: string` (line ~167) vs
  Module Contract `SkillEntry.area: Area` (line ~188, typed union)
- **Finding**: The same `SkillEntry` interface is declared twice with
  different typings for `area` (`string` vs `Area`). The Module Contract
  version is stricter and correct; the Tool Contract version is looser
  and would let `area` drift to arbitrary strings.
- **Evidence**: design.md Tool Contract: `area: string;  // one of the
  enum values, or "other"`; design.md Module Contract: `area: Area;`.
- **Recommendation**: Align both to `area: Area`. The comment "one of the
  enum values, or other" is already covered by the `Area` union which
  includes `"other"`.

### DES-002 — MEDIUM — `area` assignment step missing from contracts

- **Artifact**: `design.md`, Module Contracts
- **Location**: `parseFrontmatter` return type lacks `area`; no function
  contract assigns `area` to a `SkillEntry`
- **Finding**: `parseFrontmatter` returns `{ name, description,
  hasFrontmatter, raw }` — no `area`. But `SkillEntry` requires `area`.
  `scanSkills` must therefore derive `area` from the parsed `name` via
  reverse lookup of `AREA_TO_SKILL` after calling `parseFrontmatter`.
  This derivation step is described in prose in Phase 1.1 of tasks.md
  ("derive `area` via reverse lookup") but is **not present in any
  function contract** in design.md. An implementer reading only the
  contracts would not know who sets `area`.
- **Evidence**: design.md `parseFrontmatter` signature has no `area` in
  return type; `scanSkills` doc says "Never throws" but does not document
  the area-derivation step; tasks.md 1.1 mentions it in prose only.
- **Recommendation**: Add a one-line contract note to `scanSkills`:
  "// Each entry's `area` is derived by reverse-looking up the parsed
  `name` in AREA_TO_SKILL; unmatched names get area: 'other'."

### RSK-002 — MEDIUM — fixtures do not cover the "valid but unmapped" branch

- **Artifact**: `tasks.md`, Phase 3 fixtures
- **Location**: 3.1–3.5 list fixtures: valid, no-frontmatter, missing-desc,
  malformed, multiline-desc
- **Finding**: There is no fixture for a skill with **valid frontmatter
  whose `name` is not in AREA_TO_SKILL** — the exact case that produces
  `area: "other"` (REQ-006 scenario "Unmapped skill gets area other").
  Without that fixture, the area-derivation branch for unknown skills
  is untested.
- **Evidence**: tasks.md 3.1–3.5 enumerate 5 fixtures; none is named
  "unmapped" or "valid-but-other".
- **Recommendation**: Add fixture `tests/fixtures/skills/unmapped/SKILL.md`
  with valid frontmatter using a name absent from AREA_TO_SKILL, and a
  test asserting `entry.area === "other"`.

### STR-002 — MEDIUM — `recommend` reason content is asserted in scenarios but undefined in spec

- **Artifact**: `spec.md` REQ-003 scenarios
- **Location**: "the reason mentions motors and ACB_SmartCar_V2";
  "the reason mentions buzzer and PWM"
- **Finding**: The scenarios assert reason *content* ("mentions X and Y"),
  but the actual reason strings are only defined in `design.md` OQ-1
  (REASONS table), not in spec.md. This creates a spec↔design coupling
  where changing the reason wording in design breaks a spec scenario.
  Spec should assert structural properties (reason is non-empty string,
  reason references the skill name), not exact keywords.
- **Evidence**: spec.md REQ-003 scenario "Recommend motors skill":
  "details.recommended.reason mentions motors and ACB_SmartCar_V2".
- **Recommendation**: Soften the scenario assertions to "reason is a
  non-empty string that references the skill name" and let design.md own
  the exact wording. This keeps spec stable if REASONS text evolves.

### STR-003 — LOW — Phase 5 verify step 5.4 also hardcodes "8 entries"

- **Artifact**: `tasks.md`, Phase 5.4
- **Location**: "confirm 8 entries with correct paths"
- **Finding**: Same staleness as STR-001 but in the verify gate. Will
  report a false failure when run against the real 11-skill repo.
- **Evidence**: tasks.md 5.4: "confirm 8 entries with correct paths".
- **Recommendation**: Change to "confirm N entries matching the current
  skill count" or update to 11. Pair with the STR-001 fix.

### DES-002b — LOW — NFR-001 wording slightly contradicts ADR-001

- **Artifact**: `spec.md` NFR-001 vs `design.md` ADR-001
- **Location**: NFR-001 "no `yaml` / `gray-matter` npm dependency"
- **Finding**: Minor. NFR-001 names specific packages (`yaml`,
  `gray-matter`) which is good, but ADR-001 says "zero new runtime
  dependencies" more broadly. If the implementer adds any other dep
  (e.g. `glob`), NFR-001 would technically allow it while ADR-001
  forbids it. Align the wording.
- **Evidence**: spec.md NFR-001 lists two packages; design.md ADR-001
  says "zero new runtime dependencies".
- **Recommendation**: Change NFR-001 to "no new runtime dependencies
  (the frontmatter parser is hand-rolled)" to match ADR-001 breadth.

### ENV-001 — INFORMATIONAL — pre-existing harness bug blocks subagents

- **Artifact**: out of SDD-gate scope (runtime environment)
- **Location**: `harness/src/lib/serial.ts:116` (duplicated/truncated block)
- **Finding**: The installed extension fails to parse, which blocks Pi
  boot and therefore any subagent workflow. Must be fixed before the
  follow-up apply session can use subagents, and before `/reload` can
  load the new `robot_skills` tool.
- **Evidence**: subagent run `2d906863` error log; `serial.ts` lines
  108–135 show the `proc.on(...)` block duplicated after the function's
  closing brace.
- **Recommendation**: Fix `serial.ts` (remove the duplicated tail) in a
  separate `fix-harness-serial-parse` change BEFORE the apply session
  for `add-robot-skills-tool`. Not a blocker for the *artifacts* under
  review, but a blocker for *executing* the apply phase.

## Round 2 Findings (Human Review — H1-H3, M1-M4)

The human reviewer identified 7 deeper contract conflicts that the
inline degraded gate missed. These were structural issues in the
TypeScript contracts, not just cosmetic count/wording problems.

### H1 — HIGH — Reverse lookup of areas is incorrect by design

`AREA_TO_SKILL` is not one-to-one (`leds`/`buzzer` both map to one skill;
`app`/`web` both map to one skill). Inverting the table non-deterministically
drops one of the two areas. `SkillEntry.area` had no correct answer for
aliased skills.

**Resolution (ADR-002 rewrite):** Two explicit tables: `AREA_TO_SKILL`
(requested area → skill, for `recommend`) + `SKILL_TO_AREAS` (skill → all
areas, for classification). `SkillEntry.areas: RecommendArea[]` (plural).
No inversion. `areas: []` replaces `area: "other"`.

### H2 — HIGH — `getByName()` cannot produce the `frontmatter` it promises

The design said `frontmatter` is populated only on `get`, but `getByName`
was a sync filter over pre-scanned entries — it never reads the file and
cannot produce `frontmatter` or `body`.

**Resolution:** Replaced with `getSkillByName(skillsDir, name):
Promise<SkillEntry | null>` — async, reads the file, populates both
`frontmatter` (raw block) and `body` (full markdown). Old sync
`getByName` removed entirely.

### H3 — HIGH — Error handling contradicts itself

`scanSkills` was documented as "never throws", but the spec required
distinct error texts for ENOENT, EACCES, and empty dir — which requires
the lib to surface operational errors.

**Resolution (ADR-006):** Split by layer: `parseFrontmatter` never throws
on content. `scanSkills`/`getSkillByName` DO throw operational FS errors.
`executeSkillsAction` catches and maps them to text errors. Empty dir → `[]`
(not an error).

### M1 — MEDIUM — `get` doesn't deliver on its declared motivation

The proposal motivated `get` as "fetch the full SKILL.md" but the contract
only returned metadata + frontmatter, not the body.

**Resolution:** `getSkillByName` now returns `body: string` (full markdown).
`get` is the only action that returns `body`; `list` strips it.

### M2 — MEDIUM — `flash` handling distributed between incompatible functions

`flashEntry()` lived in `executeSkillsAction`, but tasks also told
`recommendForArea()` to handle flash — yet `recommendForArea` is pure and
can't access the external path.

**Resolution (ADR-007):** `executeSkillsAction` is the single FS/flash
authority. `recommendForArea` stays pure. Flash is handled at the tool
layer for both `recommend` and `get`.

### M3 — MEDIUM — Multiline support demanded without a specifiable grammar

Tasks asked for a "multiline-desc" fixture but the hand-rolled parser
doesn't define what YAML multiline syntax it supports.

**Resolution:** Multiline YAML is out of scope. Single-line values only.
Fixture 3.5 (multiline-desc) removed. Parser takes everything after
`description:` as-is and does not throw.

### M4 — MEDIUM — Missing scenario: `recommend` without `area`

`area` is optional in the schema (because it only applies to `recommend`),
but no scenario tested what happens when `recommend` is called without it.

**Resolution:** Added scenario to REQ-003: "Recommend without area" →
returns `"area is required for recommend action"` error text.

## Round 3 Findings (Veredicto — contract-level fixes)

The third review identified 6 implementation-breaking contract issues that
the previous rounds missed. All resolved in design.md, spec.md, and tasks.md.

### V1 — HIGH — `getSkillByName()` unsafe lookup

**Issue:** Design said `getSkillByName` constructs `<skillsDir>/<name>/SKILL.md`
directly. But directory name ≠ parsed frontmatter name, so `get` could fail
on skills that `list` returned. Also allowed path traversal via `../../`.

**Resolution:** `getSkillByName` now enumerates subdirectories (same
`readdir({ withFileTypes: true })` approach as scanSkills), parses each
SKILL.md via `parseSkillDocument`, and matches by **parsed name**. No path
concatenation with user input → no traversal. Added name-mismatch fixture
(3.9) and test (3.10).

### V2 — HIGH — `scanSkills()` no directory filtering

**Issue:** `skills/` contains `README.md`. `readdir` without filtering
would try `README.md/SKILL.md` → `ENOTDIR`. Subdirs without SKILL.md undefined.

**Resolution:** `scanSkills` uses `readdir({ withFileTypes: true })`,
skips non-directory entries, skips subdirs without SKILL.md, sorts
results by name. Added fixtures 3.7 (README.md file) and 3.8
(notes/ dir without SKILL.md).

### V3 — HIGH — `recommendForArea` non-deterministic

**Issue:** Function iterated entries and returned first whose `areas`
included the requested area — dependent on readdir order. If two skills
shared an area, either could be returned regardless of `AREA_TO_SKILL`.

**Resolution:** `recommendForArea` uses `AREA_TO_SKILL[area]` for
deterministic lookup — finds entry whose `name` matches the table value.
Test 3.10 asserts two entries with same area → always returns the
`AREA_TO_SKILL`-declared one.

### V4 — MEDIUM — `flash` flow order ambiguous

**Issue:** `get` tried local lookup first, then flash. If `skillsDir`
missing → ENOENT before reaching flash entry. Also `recommend("flash")`
could leak get-only `frontmatter`/`body` into the result.

**Resolution:** Flash bifurcation is now **before** local lookup for both
`recommend` and `get`. `recommend("flash")` strips `frontmatter`/`body`.
Added spec scenario "Recommend flash skill when skillsDir is missing" +
assertion "no frontmatter/body in details.skills".

### V5 — MEDIUM — Body extraction fragile

**Issue:** `flashEntry` used `raw.indexOf("---", ...)` substring search,
not line-complete delimiter matching. Two separate parsing algorithms
existed (frontmatter + body).

**Resolution:** Unified `parseSkillDocument(raw, fallbackName)` helper
extracts both frontmatter and body in one pass with line-complete
`---` delimiter matching. Single algorithm used by scanSkills,
getSkillByName, and flashEntry. No frontmatter → body is entire file.

### V6 — MEDIUM — Error handling needs catch-all

**Issue:** Only ENOENT/EACCES were handled. ENOTDIR, EIO, EMFILE, encoding
errors would escape and crash Pi.

**Resolution:** `executeSkillsAction` catches **all** errors. ENOENT →
"skills directory not found", EACCES → "permission denied", everything
else → generic `"Error: <safe message>"` via `safeErrorMessage()`.
Added spec scenario "Unexpected error gets generic message".

**Not run.** The change touches none of the trigger surfaces (no
`state.yaml`, `StateManager`, orchestrator, action runner, ledgers,
manifests, CLI writer paths, SSOT ownership, or competing pipelines).
Confirmed via grep across all 5 artifacts — the only matches were
incidental ("File Manifest" = file listing, "Gate" = SDD workflow gate,
"post-implementation gate" = standard verify phase). The change is a
pure additive read-only filesystem tool. Authority/connectivity audit
not applicable.

## Quorum & Tie-breaking

Round 1: all 3 inline roles completed with evidence (degraded mode,
no subagents bootable). Round 2: human review identified 7 deeper issues
the inline gate missed (H1-H3, M1-M4). Both rounds converged on the
same conclusion: the contracts needed restructuring, not just wording
fixes. No tie to break.

## Recommended Actions

1. **(prerequisite for apply)** Land `fix-harness-serial-parse` so Pi can
   load extensions and subagents can boot.
2. **(prerequisite for apply)** Re-run the 3-agent gate independently
   after the serial fix to confirm PASS with fresh agents. The resolution
   log above is an inline self-audit, not an independent verification.
3. **(apply phase)** Follow `tasks.md` phase-by-phase: index module → tool
   registration → unit tests → docs → verify.
4. **(verify phase)** Confirm tool count in `/tools` is 3 (robot_detect,
   robot_health, robot_skills) with no regression.

## Tooling Evidence Used

- Phase 0.5: `grep` injection-pattern scan across 5 artifacts → clean.
- Phase 1.5 trigger scan: `grep -iE "state\.yaml|StateManager|orchestrator|..."`
  across 5 artifacts → only incidental matches → audit skipped (correctly).
- Claim verification: `grep registerTool harness/src/index.ts`, `ls skills/`,
  `find skills -name SKILL.md | wc -l`, `grep typebox|vitest harness/package.json`,
  `head -5 skills/esp32-*/SKILL.md`, `grep esp32-connectivity design.md ...`.
- Subagent dispatch attempted via `subagent` tool (3× `delegate`) → blocked
  by ENV-001; fell back to inline evaluation per skill's degraded-mode rule.
- No Trifecta graph queries (tool does not exist in code yet; nothing to trace).

## Findings Resolution Log

### Round 1 (inline gate — STR/DES/RSK-*) — all resolved

| Finding | Severity | Resolution |
|---|---|---|
| STR-001 | high | ✅ spec REQ-002 uses "N entries (matches current skill count)"; explore/proposal/NFR-002 say "11 at time of change" with growth note |
| RSK-001 | high | ✅ ADR-002 Scope Note documents esp32-* sub-skills collapsed to `areas: []` intentionally |
| DES-001 | medium | ✅ Field renamed to `areas: RecommendArea[]` (plural, typed) in both contracts |
| DES-002 | medium | ✅ New `areasForName()` helper + `scanSkills` doc explains area derivation; `parseFrontmatter` doc notes it does NOT compute areas |
| RSK-002 | medium | ✅ Fixture 3.6 `unmapped/SKILL.md` added; `areasForName` assertions cover `areas: []` branch |
| STR-002 | medium | ✅ REQ-003 reason assertions softened to "non-empty string referencing skill name" |
| STR-003 | low | ✅ tasks 5.4 uses count-agnostic phrasing |
| DES-002b | low | ✅ NFR-001 broadened to "MUST NOT gain any new runtime dependency" |
| ENV-001 | info | ⏳ Tracked in `fix-harness-serial-parse` (separate change) |

### Round 2 (human review — H1-H3, M1-M4) — all resolved

| Finding | Severity | Resolution |
|---|---|---|
| H1 | high | ✅ ADR-002 rewritten: two explicit tables (`AREA_TO_SKILL` + `SKILL_TO_AREAS`), `SkillEntry.areas: RecommendArea[]` plural, `areas: []` for unmapped |
| H2 | high | ✅ `getByName` replaced by async `getSkillByName(skillsDir, name)` that reads the file and populates `frontmatter` + `body` |
| H3 | high | ✅ ADR-006 added: layered error handling — `parseFrontmatter` tolerant, `scanSkills`/`getSkillByName` throw operational errors, `executeSkillsAction` catches and maps |
| M1 | medium | ✅ `getSkillByName` returns `body: string` (full markdown); `get` action returns both `frontmatter` and `body` |
| M2 | medium | ✅ ADR-007 added: `executeSkillsAction` is single FS/flash authority; `recommendForArea` stays pure |
| M3 | medium | ✅ Multiline YAML out of scope; fixture 3.5 removed; parser takes single-line values only |
| M4 | medium | ✅ REQ-003 scenario "Recommend without area" added: returns "area is required" error |

### Round 3 (veredicto — contract-level) — all resolved

| Finding | Severity | Resolution |
|---|---|---|
| V1 | high | ✅ `getSkillByName` enumerates dirs + matches by parsed name (not path concat); name-mismatch fixture 3.9 added |
| V2 | high | ✅ `scanSkills` uses `readdir({ withFileTypes })`, skips non-dirs + dirs without SKILL.md, sorts by name; fixtures 3.7 + 3.8 added |
| V3 | high | ✅ `recommendForArea` uses `AREA_TO_SKILL[area]` for deterministic lookup (not iteration); test 3.10 covers two-entries-same-area case |
| V4 | medium | ✅ Flash bifurcates BEFORE local lookup; `recommend("flash")` strips frontmatter/body; spec scenario "flash when skillsDir missing" added |
| V5 | medium | ✅ Unified `parseSkillDocument` helper replaces separate frontmatter/body parsers; line-complete `---` delimiters |
| V6 | medium | ✅ `executeSkillsAction` catches ALL errors; generic `"Error: <safe message>"` for non-ENOENT/EACCES; spec scenario added |

**Overall gate status: REVIEW** — all 21 findings across 3 rounds resolved
in the artifacts. No PASS claim until an independent 3-agent gate re-run
confirms after `fix-harness-serial-parse` lands.
