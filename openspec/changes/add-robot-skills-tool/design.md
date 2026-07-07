# Design — add-robot-skills-tool

> SDD design phase. Resolves open questions from spec, defines technical
> contracts, and documents architecture decisions.
>
> Traceability: finding IDs (`RISK-*`, `H*`, `M*`, `veredicto finding *`)
> refer to the historical gate reports in this same change directory:
> `gate-report.md`, `gate-report-r4.md`, and later rerun outputs.

## Open Questions Resolved

### OQ-1: Shape of `reason` in `recommend` (resolves SPEC-OQ-1)

**Decision**: Fixed template per area, looked up from a `REASONS` table
alongside `AREA_TO_SKILL`. Each reason is one short sentence citing the
skill name and the key topic.

**Rationale**: A fixed template is deterministic and testable. Deriving
the reason from the description risks leaking long, noisy text into the
structured output. The agent reads the full description via `get` if it
wants detail.

**Contract**:

```typescript
const REASONS: Record<RecommendArea, string> = {
  motors:   "qd001-motors-mecanum covers holonomic movement and the ACB_SmartCar_V2 library.",
  sensors:  "qd001-sensors covers the HC-SR04 ultrasonic and IR line-tracking sensors.",
  servo:    "qd001-servo-scan covers the pan servo (GPIO25) and obstacle-avoidance sweep.",
  ir:       "qd001-ir-remote covers the IR receiver (pin 4) and Acebott remote codes.",
  leds:     "qd001-leds-buzzer covers the on-board LEDs and PWM control.",
  buzzer:   "qd001-leds-buzzer covers the buzzer, tones, and PWM (shared with leds).",
  app:      "qd001-app-control covers the Acebott app protocol and WiFi AP setup.",
  web:      "qd001-app-control covers web control (including the iOS Safari rendering bug).",
  embedded: "embedded-systems-engineering covers firmware review, ISR/RTOS, and skill vetting.",
  esp32:    "esp32-arduino-development covers the ESP32 + arduino-cli toolchain.",
  flash:    "acebott-esp32-flash is the canonical flash workflow (external, user-level skill).",
};
```

### OQ-2: `get` returns raw frontmatter and body (resolves SPEC-OQ-2)

**Decision**: `get` returns the parsed fields (`name`, `description`,
`path`, `areas`) AND a `frontmatter` string field containing the raw
text between the `---` delimiters (empty string if none) AND a `body`
string field containing the full markdown body (everything after the
frontmatter block, or the entire file if no frontmatter).

**Rationale**: The agent sometimes needs the exact frontmatter (e.g. to
echo it into a prompt or compare two skills). The body is the primary
value of `get` over `list` — the agent reads the full SKILL.md without
a second filesystem round-trip.

**Contract**: `SkillEntry` gains optional `frontmatter?: string` and
`body?: string` fields, populated only by `getSkillByName()` (or
`flashEntry()` for the external skill). A unified `parseSkillDocument()`
helper extracts both from the raw file content — there is ONE parsing
algorithm, not separate ones for frontmatter and body.

### OQ-3: `flash` external path resolution (resolves SPEC-OQ-3)

**Decision**: The `flash` area maps to a synthetic entry whose `path`
points to `~/.pi/agent/skills/acebott-esp32-flash/SKILL.md` (resolved
via `os.homedir()`). The entry is marked `areas: ["flash"]` and the
reason notes it is external. If that file does not exist,
`recommend("flash")` returns an error text explaining the external skill
is not installed. The canonical error text is
`"External flash skill not installed: acebott-esp32-flash"`.

**Rationale**: The agent gets actionable info (the exact path) rather
than a dead-end "not found". A single try-read avoids TOCTOU — no
separate existence check followed by a read.

**Contract** (ADR-007: `executeSkillsAction` is the single FS authority;
`flashEntry` is its helper, called directly for recommend/get with flash):

```typescript
async function flashEntry(): Promise<SkillEntry | null> {
  const p = path.join(
    os.homedir(),
    ".pi/agent/skills/acebott-esp32-flash/SKILL.md",
  );
  // No existsSync — avoid TOCTOU (veredicto finding 7). Try-read directly,
  // catch ENOENT → null, re-throw everything else (EACCES, EIO, etc.)
  let raw: string;
  try {
    raw = await fs.promises.readFile(p, "utf-8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error; // EACCES, EIO, etc. — propagate to executeSkillsAction catch-all
  }
  const doc = parseSkillDocument(raw, "acebott-esp32-flash");
  return {
    name: doc.name,
    path: p,
    description: doc.description,
    areas: ["flash"],
    hasFrontmatter: doc.hasFrontmatter,
    frontmatter: doc.frontmatter,
    body: doc.body,
  };
}
```

If the file does not exist (`ENOENT`), `flashEntry()` returns `null`.
Read failures propagate to `executeSkillsAction`: `EACCES` is mapped to
`"Permission denied while reading external flash skill"`; `EIO` and other
codes use `"Error: <msg>"` (generic pass-through).

## Architecture Decisions

### ADR-001: Hand-rolled frontmatter parser (no YAML dep)

**Context**: Need to parse trivially simple YAML frontmatter (two keys)
tolerantly — never throw on malformed input.

**Decision**: Hand-rolled parser using line-prefix matching inside the
block delimited by the first two lines equal to `---`.

**Consequences**:

- Zero new runtime dependencies (NFR-001)
- Full control over tolerance behavior
- Limitation: does not handle quoted multi-line YAML values; acceptable
  since all current skills use single-line `name:` and `description:`

### ADR-002: Explicit area mapping, two separate tables (resolves H1)

**Context**: A single `AREA_TO_SKILL` table is a one-to-one map and cannot
represent that one skill serves multiple areas (`qd001-leds-buzzer` covers
both `leds` and `buzzer`; `qd001-app-control` covers `app` and `web`).
Deriving classification by "inverting" `AREA_TO_SKILL` is non-deterministic
for aliases — the inversion silently drops one of the two areas depending
on iteration order, so `SkillEntry.area` had no correct answer for aliased
skills.

**Decision**: Keep **two explicit tables**, not one derived from the other:

- `AREA_TO_SKILL: Record<RecommendArea, string>` — requested area → skill
  (used by `recommend`; aliases are first-class and explicit here).
- `SKILL_TO_AREAS: Record<string, readonly RecommendArea[]>` — skill → all
  areas it serves (used to classify skills in `list`/`scanSkills`).

`SkillEntry` exposes `areas: readonly RecommendArea[]` (plural). Unmapped skills
get `areas: []` — there is no `"other"` sentinel in the enum; an empty
array IS the "other" marker.

**Consequences**:

- Two tables to maintain in lockstep (acceptable: both are pure data,
  trivially testable, and the test suite asserts they agree).
- Aliases are explicit and deterministic, never inferred.
- Adding a skill means adding to `SKILL_TO_AREAS`; adding a new requested
  area means adding to both tables and the `RecommendArea` union.

**Scope Note (esp32-* sub-skills)**: At the time of this change, the repo
contains three additional ESP32-focused skills not in `SKILL_TO_AREAS`:
`esp32-connectivity`, `esp32-low-level-io`, `esp32-rtos-power`. These are
**intentionally left unmapped** (`areas: []`) because the enum has a single
coarse `esp32` slot (pointing at `esp32-arduino-development`, the toolchain
reference). Finer areas (`connectivity`, `low-level`, `rtos`) are a
**deferred future enhancement**, not an oversight. Behavior:

- `list` returns these three skills with `areas: []` (still discoverable
  by name).
- `recommend("esp32")` returns `esp32-arduino-development` only; it does
  NOT enumerate the three sub-skills. The agent can `get` them by name.
- Adding finer areas later = extend `RecommendArea` + both tables; the
  `SkillEntry`/`SkillsResult` contracts do not change.

### ADR-003: Re-scan every call (no cache)

**Context**: 11 files at the time of this change (and growing), sub-5ms
scan. Caching adds stale-state risk during development (skills are edited
frequently).

**Decision**: `scanSkills()` reads the directory fresh on every call.

**Consequences**:

- Always reflects current filesystem state
- No cache invalidation logic
- If profiling later shows cost, add an mtime-based cache (future change)

### ADR-004: Tool file colocated with detect/health

**Context**: The harness already has `src/tools/detect.ts` and
`src/tools/health.ts`. The new tool follows the same pattern.

**Decision**: `src/tools/skills.ts` exports `registerSkillsTool(pi)` and
a pure `executeSkillsAction()` function for testing.

**Consequences**:

- Consistent with existing structure
- `index.ts` gains one import + one registration call

### ADR-005: Fixtures for unit tests

**Context**: Testing against the real `skills/` dir is non-deterministic
(it grows as the project evolves).

**Decision**: Unit tests use `tests/fixtures/skills/` with crafted
`SKILL.md` files covering each parser branch (valid, no-frontmatter,
missing-key, malformed, unmapped).

**Consequences**:

- Deterministic tests
- Fixtures are versioned with the harness
- Real `skills/` is not asserted on directly

### ADR-006: Layered error handling — parse-tolerant, FS-honest (resolves H3)

**Context**: An earlier draft said `scanSkills()` "never throws". But the
spec requires distinguishing three filesystem outcomes: missing directory
(`ENOENT`), permission denied (`EACCES`), and empty directory. A
never-throws `scanSkills` cannot tell the caller which occurred, so the
tool could not produce the spec's distinct error texts.

**Decision**: Split error responsibility by layer:

- `parseSkillDocument()` — NEVER throws on malformed/missing **content**.
  Tolerance applies to file *contents* only.
- `scanSkills()` / `getSkillByName()` — DO throw operational filesystem
  errors (`ENOENT`, `EACCES`, read failures). These are genuine failures,
  not parse problems, and must surface. An existing-but-empty directory
  resolves to `[]` (not an error). A valid directory with no matching
  skill resolves to `null` (not an error).
- `executeSkillsAction()` — the ONLY layer that catches errors and
  converts them into the tool's text-error response shape. It catches
  **all** errors, not just ENOENT/EACCES: specific codes get specialized
  text (`ENOENT` → "skills directory not found", `EACCES` → "permission
  denied"); everything else gets a generic `"Error: <msg>"` using the
  **existing harness convention** (same as `detect.ts`):
  `const msg = err instanceof Error ? err.message : String(err)`.
  No new `safeErrorMessage` helper is introduced — the tool follows the
  same pass-through pattern the harness already uses. The tool NEVER throws.

**Consequences**:

- Parsing stays tolerant (malformed YAML never crashes the tool).
- Real filesystem failures are visible, not swallowed.
- The lib functions stay testable: tests assert they throw the right
  codes; tests assert `executeSkillsAction` maps them to the right texts.

### Unified flash error matrix (v2 — resolves veredicto finding 3)

The `flash` skill lives outside `skills/` (user-level install at
`~/.pi/agent/skills/acebott-esp32-flash/`). Its error handling is
independent of the local `skillsDir`. The matrix below covers all
combinations. The `get` path uses the same external-skill message as
`recommend` when the flash file is missing — the user-facing meaning
is identical ("flash skill not available"), and a separate "Skill not
found" message would be misleading because the name IS known.

| Operation | Condition | Result |
|-----------|-----------|--------|
| recommend flash | ENOENT | `"External flash skill not installed: acebott-esp32-flash"` |
| get flash | ENOENT | `"External flash skill not installed: acebott-esp32-flash"` |
| recommend flash | EACCES | `"Permission denied while reading external flash skill"` |
| get flash | EACCES | `"Permission denied while reading external flash skill"` |
| recommend flash | EIO/other | `"Error: <msg>"` (generic pass-through) |
| get flash | EIO/other | `"Error: <msg>"` (generic pass-through) |
| recommend local | ENOENT | `"skills directory not found"` |
| recommend local | EACCES | `"Permission denied"` |
| recommend local | EIO/other | `"Error: <msg>"` (generic pass-through) |
| get local | ENOENT | `"skills directory not found"` |
| get local | EACCES | `"Permission denied"` |
| get local | EIO/other | `"Error: <msg>"` (generic pass-through) |
| recommend | entry:null | `"Skill not found for area: <area>"` |
| get | null | `"Skill not found: <name>"` |
| recommend | no area | `"area is required for recommend action"` |
| get | no name | `"name is required for get action"` |

### ADR-007: `executeSkillsAction` is the single FS/flash authority (resolves M2)

**Context**: The `flash` area points to an external user-level skill
(`~/.pi/agent/skills/acebott-esp32-flash/`) that is NOT under `<cwd>/skills/`.
An earlier draft split flash handling between `executeSkillsAction` (which
owned `flashEntry()`) and `recommendForArea` (which tasks.md also told to
handle flash), but `recommendForArea` is a pure function over scanned
entries and cannot reach the external path.

**Decision**: `executeSkillsAction` is the **single** authority for
filesystem access and the external flash entry:

- `recommendForArea(entries, area)` stays PURE — it only filters the
  entries handed to it. It never touches the filesystem and never handles
  flash.
- `executeSkillsAction`, on `recommend` with `area === "flash"`, calls
  `flashEntry()` directly and bypasses `recommendForArea`.
- `executeSkillsAction`, on `get` with `name === "acebott-esp32-flash"`,
  calls `flashEntry()` so the external skill is fetchable by name too.
- `flashEntry()` owns its own filesystem access (`os.homedir()` + try-read,
  catching only ENOENT → null) and returns `null` if the external skill is
  absent; the tool maps that to the exact text
  `"External flash skill not installed: acebott-esp32-flash"`.

**Consequences**:

- One place to audit for side effects (only `executeSkillsAction` + the
  two lib read functions touch the disk).
- `recommendForArea` is trivially unit-testable (pure).
- `flash` is uniformly handled across `recommend` and `get`.

### ADR-008: Read-only tool — no writes, no subprocesses, no hardware access

**Context**: REQ-007 requires `robot_skills` to be strictly read-only.

**Decision**: All `robot_skills` functions are read-only filesystem helpers.
They MAY read `SKILL.md` files under `<cwd>/skills/` and the external
flash skill path. They MUST NOT write, move, delete, spawn subprocesses,
flash firmware, open serial ports, or touch hardware.

**Consequences**:

- Rollback is clean (remove new files + index registration).
- `robot_detect` and `robot_health` remain the only hardware-aware tools.
- Unit tests can run with no robot connected.

## Tool Contract (final)

### `robot_skills`

> **RISK-001 resolved:** `StringEnum` is NOT a typebox 0.34 export. The
> tool defines a local helper per the typebox README recipe:

```typescript
// Local helper — typebox 0.34 has no built-in StringEnum (it's a README recipe)
// Use <const T extends readonly string[]> + [...values] to preserve literal union
const StringEnum = <const T extends readonly string[]>(values: T) =>
  Type.Unsafe<T[number]>({ type: "string", enum: [...values] });

parameters: Type.Object({
  action: StringEnum(["recommend", "list", "get"]),
  area: Type.Optional(StringEnum([
    "motors", "sensors", "servo", "ir", "leds", "buzzer",
    "app", "embedded", "esp32", "flash", "web",
  ])),
  name: Type.Optional(Type.String()),
}),
// Returns: { content: [{type:"text", text: <summary>}], details: <SkillsResult> }
```

**Key data-shape decisions (resolves H1):** the tool separates two
concepts that the previous design conflated:

1. **Requested area** — what the caller passes to `recommend`. Admits
   aliases (`leds`/`buzzer` both resolve to one skill; `app`/`web` too).
2. **Skill classification** — how a skill is tagged. A skill may cover
   more than one area (e.g. `qd001-leds-buzzer` covers both `leds` and
   `buzzer`).

Therefore `SkillEntry` exposes `areas: readonly RecommendArea[]` (plural, the
full set of areas the skill serves) — never a singular `area`. The
legacy singular `area` field is removed. `RecommendArea` is the enum
without `"other"`; classification uses a separate marker for unmapped
skills.

```typescript
// Full file body is returned by `get` (resolves M1): the tool's value
// over `list` is that it hands the agent the complete SKILL.md so it
// can be read/echoed without a second filesystem round-trip.
interface SkillEntry {
  name: string;
  path: string;
  description: string;
  areas: readonly RecommendArea[];  // all areas this skill serves; [] if unmapped
      hasFrontmatter: boolean;
      frontmatter?: string;     // raw block between the --- delimiters; `get` only
  body?: string;            // full markdown body of SKILL.md; `get` only
}

interface SkillsResult {
  skills: SkillEntry[];     // present for list, get, and recommend
  recommended?: { name: string; path: string; reason: string };
                             // present only for a successful recommend
}
```

Action dispatch (resolves H2, H3, M2, finding 4 — `executeSkillsAction`
is the single authority that owns filesystem access, error mapping, and
the external `flash` entry):

- `list` → call `scanSkills(cwd/skills)`. On `ENOENT`/`EACCES`, map to
  the matching error text and return `details.skills = []`. On an empty
  directory, return `details.skills = []` with the "No skills found in
  <path>" text (includes the inspected path). Strip `frontmatter`/`body` from each entry before returning
  (list returns metadata only).
- `recommend` → **require `area`**; if absent, return the
  `"area is required for recommend action"` error text, no `recommended`,
  empty `skills`. **Flash bifurcation FIRST** (finding 4): if
  `area === "flash"`, call `flashEntry()` directly — no local scan, so
  a missing `skillsDir` cannot shadow the external skill. Strip
  `frontmatter`/`body` from the returned entry (get-only fields). For
  non-flash areas: call `scanSkills()`, then `recommendForArea(entries,
  area)` — a pure function that uses `AREA_TO_SKILL[area]` for
  deterministic lookup (finding 3), not iteration order. If it returns
  `entry: null`, return error text `Skill not found for area: <area>`,
  omit `details.recommended`, and return `details.skills = []`. If it
  finds an entry, return `details.recommended` and ALSO include the single
  matching entry in `details.skills` (so the caller gets the path without
  a second call).
- `get` → **require `name`**; if absent, return the
  `"name is required for get action"` error text. **Flash bifurcation
  FIRST** (finding 4): if `name === "acebott-esp32-flash"`, call
  `flashEntry()` directly — no local scan. On ENOENT, return the exact
  flash-not-installed text (same as recommend — see error matrix). On
  EACCES, return permission denied. Otherwise call the async
  `getSkillByName(cwd/skills, name)` which enumerates subdirectories,
  parses each SKILL.md, and matches by parsed name (finding 1 — safe
  lookup, no path concatenation). If found, return the entry (with
  `frontmatter` and `body`) in `details.skills`. If not found, return
  the `"Skill not found: <name>"` error text, empty `skills`.

**Error-handling layering (resolves H3 + finding 6):**

- `parseSkillDocument()` NEVER throws on malformed/missing **content**.
- `scanSkills()` / `getSkillByName()` DO throw operational filesystem
  errors (`ENOENT`, `EACCES`, read failures) — these are real failures,
  not parse problems. An empty-but-existing directory returns `[]` (not
  an error). A valid directory with no matching skill returns `null` (not
  an error).
- `executeSkillsAction()` is the ONLY place that catches errors and
  converts them into the tool's text-error response shape. It catches
  **all** errors: `ENOENT` → "skills directory not found", `EACCES` →
  "permission denied", everything else → generic `"Error: <msg>"` using
  the existing harness convention (`err instanceof Error ? err.message :
  String(err)`). The tool NEVER throws — all errors become text responses.

## Module Contracts

### `lib/skills-index.ts`

```typescript
// The caller-facing enum (no "other" — "other" is represented as areas: []).
export type RecommendArea =
  | "motors" | "sensors" | "servo" | "ir" | "leds" | "buzzer"
  | "app" | "embedded" | "esp32" | "flash" | "web";

// Local areas only — excludes "flash" (which is handled separately by
// executeSkillsAction via flashEntry). Used by recommendForArea's type
// signature to prevent accidental flash calls at the type level.
export type LocalRecommendArea = Exclude<RecommendArea, "flash">;

export interface SkillEntry {
  name: string;
  path: string;
  description: string;
  areas: readonly RecommendArea[];  // all areas this skill serves; [] if unmapped
  hasFrontmatter: boolean;
  frontmatter?: string;     // raw block; populated only by get/getSkillByName
  body?: string;            // full markdown body; populated only by get/getSkillByName
}

// Unified parsed document — ONE parsing algorithm for both frontmatter
// and body. Used by scanSkills (name/desc only), getSkillByName (all
// fields), and flashEntry (all fields). Never throws on content.
export interface ParsedSkillDocument {
  name: string;
  description: string;
  hasFrontmatter: boolean;
  frontmatter: string;    // raw block between --- delimiters; "" if none
  body: string;           // full markdown after frontmatter; entire file if no FM
}

// Maps a requested area (with aliases) to ONE skill name. Aliases are first-class:
// "leds" and "buzzer" both → "qd001-leds-buzzer"; "app" and "web" both →
// "qd001-app-control". This is the authoritative table for recommend().
export const AREA_TO_SKILL: Record<RecommendArea, string>;

// Maps a skill name to ALL areas it serves (resolves H1). This is an
// EXPLICIT table, NOT derived by inverting AREA_TO_SKILL — inverting would
// non-deterministically drop aliases. qd001-leds-buzzer serves ["leds","buzzer"].
export const SKILL_TO_AREAS: Record<string, readonly RecommendArea[]>;

// Reason text for each requested area (used by recommend()).
export const REASONS: Record<RecommendArea, string>;

// Pure helper: returns the areas a skill serves, or [] if unmapped.
// Reads only from SKILL_TO_AREAS — no inversion, no guessing.
export function areasForName(name: string): readonly RecommendArea[];

// Unified parser: extracts frontmatter + body from raw SKILL.md content.
// NEVER throws on malformed/missing content. Single-line YAML values only
// (multiline is out of scope — M3). Returns ParsedSkillDocument with all
// fields populated. This is the ONE parsing algorithm used everywhere.
//
// First-line enforcement (v2 — resolves ambiguous parsing): frontmatter
// exists ONLY if the first logical line of the document is exactly "---".
// If line 1 is not "---", the entire raw document is body (hasFrontmatter:
// false, name/description fallback). After a valid opening delimiter on
// line 1, locate the next COMPLETE LINE equal to "---" (not a partial
// match or a line that contains "---" as a substring). If no closing "---"
// is found before EOF, treat as no-frontmatter: hasFrontmatter: false,
// frontmatter: "", body: entire raw. This prevents partial/malformed
// frontmatter blocks from being treated as valid. Everything between
// two valid delimiters is the frontmatter block; everything after the
// closing delimiter is the body.
//
// Quote stripping (RISK-003): if a value starts AND ends with a matching
// quote pair (" or '), strip them. This handles the flash skill's quoted
// description and any other quoted single-line values. Unmatched quotes
// are left as-is (tolerant degradation).
export function parseSkillDocument(
  raw: string,
  fallbackName: string,
): ParsedSkillDocument;

// Scans a skills directory. THROWS operational filesystem errors
// (ENOENT, EACCES) — executeSkillsAction catches them per ADR-006.
// An existing-but-empty directory resolves to [] (not an error).
//
// Directory filtering: uses readdir({ withFileTypes: true }) to enumerate
// entries. Skips non-directory entries (e.g. README.md at skills/ root).
// Skips subdirectories that don't contain a SKILL.md file (not a valid
// skill). Reads each <dir>/SKILL.md, calls parseSkillDocument() to extract
// name/description, assigns entry.areas via areasForName(name). If a
// SKILL.md disappears between readdir and readFile (per-file ENOENT), skip
// that entry instead of mapping the whole directory to "skills directory
// not found". Other per-file read errors (EACCES/EIO) still throw. Results
// are sorted by name for deterministic output (avoids readdir-order
// dependency in tests and tool output).
//
// Does NOT populate frontmatter/body on returned entries (those are
// get-only fields — parseSkillDocument is called but only name/desc are
// extracted for scan results).
export async function scanSkills(skillsDir: string): Promise<SkillEntry[]>;

// Reads ONE skill by parsed name (NOT by directory name). Enumerates
// subdirectories of skillsDir, parses each SKILL.md's frontmatter, and
// matches by the parsed `name` field against `requestedName`. This is
// safe because:
//   1. Directory name ≠ parsed name (e.g. a dir named "foo" might have
//      name: "bar" in its frontmatter). The parsed name is authoritative.
//   2. No path concatenation with user input — readdir enumerates dirs,
//      parseSkillDocument extracts the name, then string comparison.
//   3. Path traversal is impossible: readdir returns directory entries,
//      and we only read <dir>/SKILL.md inside skillsDir.
//
// Per-entry error handling (parallels scanSkills):
//   - Per-entry ENOENT (SKILL.md disappears between readdir and readFile):
//     skip that entry and continue. Do NOT abort the search or propagate
//     as "skills directory not found".
//   - Root readdir ENOENT (skillsDir itself missing): propagate.
//   - Per-entry EACCES/EIO (unreadable SKILL.md): propagate.
//
// Returns the entry WITH populated frontmatter and body (the only
// function that does this — resolves H2). Returns null if no skill
// matches (including when all entries were skipped due to per-entry
// ENOENT). THROWS on operational FS errors (skillsDir missing = ENOENT,
// unreadable = EACCES). A skillsDir that exists but has no matching
// skill returns null (not an error — the dir is valid, just no match).
//
// Duplicate names: if two subdirectories produce the same parsed name,
// the first match wins AFTER sorting directory names alphabetically
// (deterministic — does not depend on readdir order). This is a data
// integrity issue that should be caught by tests, not by runtime error.
// The enumeration sorts subdirectory names before matching so "first"
// is well-defined.
export async function getSkillByName(
  skillsDir: string,
  requestedName: string,
): Promise<SkillEntry | null>;

// Pure: given scanned entries and a requested area, returns the matching
// entry + reason, or { entry: null, reason }.
//
// Area type: accepts LocalRecommendArea (RecommendArea excluding "flash").
// This function does NOT handle flash — executeSkillsAction branches
// BEFORE calling this for flash (resolves M2). The narrower type
// prevents accidental flash calls at the type level.
//
// DOES NOT iterate — uses AREA_TO_SKILL[area] for deterministic lookup
// (resolves H3/finding 3 from veredicto). Finds the entry whose `name`
// matches AREA_TO_SKILL[area]. If no matching entry exists in the
// scanned list, returns { entry: null, reason }.
//
// DOES NOT touch the filesystem.
export function recommendForArea(
  entries: readonly SkillEntry[],
  area: LocalRecommendArea,
): { entry: SkillEntry | null; reason: string };

// Local guard for Node filesystem errors used by flashEntry/read error mapping.
// Checks structural code presence instead of relying on instanceof subclasses.
// NOT exported — internal to lib/skills-index.ts only.
function isNodeError(error: unknown): error is NodeJS.ErrnoException;

// Resolves the external flash skill at
// ~/.pi/agent/skills/acebott-esp32-flash/SKILL.md via os.homedir().
// Reads the file, calls parseSkillDocument (handles quoted description).
// Returns SkillEntry | null:
//   - null if file missing (ENOENT)
//   - THROWS on read failure (EACCES, EIO, etc.)
// Only called by executeSkillsAction (ADR-007).
export async function flashEntry(): Promise<SkillEntry | null>;
```

### `tools/skills.ts`

```typescript
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RecommendArea, SkillEntry } from "../lib/skills-index.js";

// Response shape — exported so tests can assert against typed results
// without re-defining the structure (prevents contract divergence).
export interface SkillsResult {
  skills: SkillEntry[];
  recommended?: {
    name: string;
    path: string;
    reason: string;
  };
}

export interface SkillsToolResponse {
  content: Array<{ type: "text"; text: string }>;
  details: SkillsResult;
}

export function registerSkillsTool(pi: ExtensionAPI): void;

// The single authority that owns filesystem access, the external flash
// entry, and error→text mapping. Wraps scanSkills/getSkillByName/flashEntry
// and converts errors into text-error responses.
//
// Error handling: catches ALL errors (not just ENOENT/EACCES). Specific
// codes get specialized text; everything else gets a generic message
// using the existing harness convention (err instanceof Error ? err.message
// : String(err)). No safeErrorMessage helper. The tool NEVER throws — all
// errors become { content:[{type:"text", text:"Error: ..."}], details:{skills:[]} }.
//
// Flash bifurcation (resolves finding 4): for both `recommend` and `get`,
// flash is checked BEFORE the local skills directory. If area/name matches
// the flash skill, flashEntry() is called directly — no local ENOENT can
// occur first. This prevents a missing skillsDir from shadowing the
// external skill.
//
// CWD wiring (RISK-F1): registerSkillsTool obtains cwd from the Pi execute
// context (`ctx.cwd` or equivalent), NOT process.cwd(), and passes it into
// executeSkillsAction so tests can inject a fixture cwd.
//
// For `recommend("flash")`, the returned entry is stripped of frontmatter
// and body (those are get-only fields) to prevent data leakage.
export async function executeSkillsAction(params: {
  action: "recommend" | "list" | "get";
  area?: RecommendArea;
  name?: string;
  cwd: string;
}): Promise<SkillsToolResponse>;
```

**Removed/renamed from earlier draft (resolves M1):** the old
`getByName(entries, name)` sync filter is gone — it could not produce
`frontmatter`/`body`. Its job is split: `recommend`/`list` use the pure
`recommendForArea`/`scanSkills`; `get` uses the async
`getSkillByName(skillsDir, name)` which actually reads the file.

## Constants additions

No new constants file; the area mapping lives in `lib/skills-index.ts`
as pure data (`AREA_TO_SKILL`, `SKILL_TO_AREAS`, `REASONS`).

## File Manifest (delta)

```
harness/
├── src/
│   ├── index.ts                     ← +1 import, +1 registerSkillsTool(pi) call
│   ├── tools/
│   │   └── skills.ts                ← NEW
│   └── lib/
│       └── skills-index.ts          ← NEW
├── tests/
│   ├── unit/
│   │   └── skills.test.ts           ← NEW
│   └── fixtures/
│       └── skills/                  ← NEW
│           ├── valid/SKILL.md
│           ├── no-frontmatter/SKILL.md   ← also has --- in body (first-line enforcement)
│           ├── missing-desc/SKILL.md
│           ├── missing-name/SKILL.md     ← 3.3b (fallback name = dir name)
│           ├── malformed/SKILL.md
│           ├── unmapped/SKILL.md
│           ├── quoted-desc/SKILL.md       ← RISK-003 (quoted frontmatter)
│           ├── unmatched-quote/SKILL.md   ← 3.6c (one-sided quote, stays as-is)
│           ├── empty-desc/SKILL.md        ← 3.6c (description: with no value → "unknown")
│           ├── unterminated-frontmatter/SKILL.md ← 3.6d (opening --- no closing → no FM)
│           ├── README.md                  ← 3.7 (non-directory entry, skipped)
│           ├── notes/                     ← 3.8 (dir without SKILL.md, skipped)
│           ├── foo/SKILL.md               ← 3.9 (name-mismatch: dir=foo, name=bar)
│           ├── dup-a/SKILL.md             ← 3.9b (duplicate name: same-name)
│           └── dup-b/SKILL.md             ← 3.9b (duplicate name: same-name)
├── skill/
│   └── SKILL.md                     ← updated (document robot_skills)
└── README.md                        ← updated (document robot_skills)
```

## Next Steps

Proceed to **tasks** phase to break this into implementable units. Gate
on design+tasks before apply. Implementation is deferred to a follow-up
session (see tasks.md Implementation Note).
