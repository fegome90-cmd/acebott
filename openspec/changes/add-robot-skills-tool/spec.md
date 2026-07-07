# Spec — add-robot-skills-tool

> SDD spec phase. Formal requirements with Given/When/Then scenarios.
> References: proposal.md, explore.md

## Requirements

### REQ-001: Tool registration

The harness MUST register a third native tool `robot_skills` alongside
the existing `robot_detect` and `robot_health`, via the same
`pi.registerTool` API.

**Scenarios:**

```gherkin
Scenario: Tool appears in /tools after reload
  Given the harness is installed and Pi is running
  When the developer runs /reload
  Then /tools lists robot_skills
  And robot_detect and robot_health are still listed (no regression)

Scenario: Tool has the three required parameters
  Given the robot_skills tool is registered
  When its parameter schema is inspected
  Then it exposes action: enum(recommend, list, get)
  And area: optional enum(motors, sensors, servo, ir, leds, buzzer, app, embedded, esp32, flash, web)
  And name: optional string
```

### REQ-002: `list` action

The `list` action MUST return every skill found in `<cwd>/skills/` with
its parsed metadata, without requiring `area` or `name`. Only
subdirectories containing a `SKILL.md` file are included — non-directory
entries (e.g. `README.md`) and subdirectories without `SKILL.md` are
skipped. Results are sorted by name for deterministic output.

**Scenarios:**

```gherkin
Scenario: List all skills in a populated directory
  Given <cwd>/skills/ contains N skill subdirectories each with a SKILL.md
    (N matches the current skill count; the number grows over time)
  When the agent calls robot_skills with action: "list"
  Then the result details.skills has exactly N entries
  And each entry has name, path, description, and areas (an array)
  And each path is an absolute path ending in /SKILL.md
  And results are sorted by entry.name
  And no entry in a list response carries frontmatter or body
    (those fields are get-only)

Scenario: List skips non-directory entries
  Given <cwd>/skills/ contains a README.md file (not a directory)
  When the agent calls robot_skills with action: "list"
  Then README.md is NOT included in the results
  And only subdirectories with SKILL.md are returned

Scenario: List skips subdirectories without SKILL.md
  Given <cwd>/skills/ contains a subdirectory "notes/" without SKILL.md
  When the agent calls robot_skills with action: "list"
  Then "notes/" is NOT included in the results

Scenario: List skips a skill file removed during scan
  Given scanSkills enumerates a subdirectory that originally had SKILL.md
  And that SKILL.md disappears before readFile
  When scanSkills reads entries
  Then it skips that entry
  And executeSkillsAction does NOT map it to "skills directory not found"

Scenario: List with empty skills directory
  Given <cwd>/skills/ exists but has no SKILL.md files
  When the agent calls robot_skills with action: "list"
  Then the result details.skills is an empty array
  And the result text says "No skills found in <path>"

Scenario: List when skills directory is missing
  Given <cwd>/skills/ does not exist
  When the agent calls robot_skills with action: "list"
  Then the tool returns an error text "skills directory not found"
  And details.skills is an empty array
  And the tool does NOT throw (scanSkills throws ENOENT;
    executeSkillsAction catches and maps it)

Scenario: List when skills directory is unreadable
  Given <cwd>/skills/ exists but cannot be read (EACCES)
  When the agent calls robot_skills with action: "list"
  Then the tool returns an error text mentioning permission denied
  And details.skills is an empty array
  And the tool does NOT throw
```

### REQ-003: `recommend` action

The `recommend` action MUST, given an `area`, return the single best
skill for that area plus a human-readable reason and the exact path to
load. A successful recommend ALSO includes the matching entry in
`details.skills` (so the caller gets the path without a second call).
The recommended entry in `details.skills` does NOT include `frontmatter`
or `body` (those are get-only fields).

For the `flash` area, `executeSkillsAction` calls `flashEntry()` directly
— no local directory scan occurs, so a missing `skillsDir` cannot prevent
the external skill from being found.

**Scenarios:**

```gherkin
Scenario: Recommend motors skill
  Given the skills directory contains qd001-motors-mecanum
  When the agent calls robot_skills with action: "recommend", area: "motors"
  Then details.recommended.name is "qd001-motors-mecanum"
  And details.recommended.path ends with "skills/qd001-motors-mecanum/SKILL.md"
  And details.recommended.reason is a non-empty string that references
    the skill name (exact wording is owned by design.md REASONS)
  And details.skills contains exactly one entry — the recommended skill
  And that entry has no frontmatter or body fields

Scenario: Recommend buzzer skill (alias of leds)
  Given the skills directory contains qd001-leds-buzzer
  When the agent calls robot_skills with action: "recommend", area: "buzzer"
  Then details.recommended.name is "qd001-leds-buzzer"
  And the reason is a non-empty string that references the skill name

Scenario: Recommend web skill (alias of app)
  Given the skills directory contains qd001-app-control
  When the agent calls robot_skills with action: "recommend", area: "web"
  Then details.recommended.name is "qd001-app-control"

Scenario: Recommend flash skill (external)
  Given the external skill ~/.pi/agent/skills/acebott-esp32-flash/SKILL.md exists
  When the agent calls robot_skills with action: "recommend", area: "flash"
  Then details.recommended.name is "acebott-esp32-flash"
  And details.recommended.path points to the user-level skills directory
  And the reason notes this is an external (non-repo) skill
  And the entry in details.skills has no frontmatter or body (get-only)

Scenario: Recommend flash skill when external is not installed
  Given the external skill ~/.pi/agent/skills/acebott-esp32-flash/SKILL.md does NOT exist
  When the agent calls robot_skills with action: "recommend", area: "flash"
  Then the tool returns the exact error text "External flash skill not installed: acebott-esp32-flash"
  And details.recommended is absent
  And details.skills is empty

Scenario: Recommend flash skill when external is unreadable (EACCES)
  Given the external skill ~/.pi/agent/skills/acebott-esp32-flash/SKILL.md exists
  And the file is unreadable (permission denied)
  When the agent calls robot_skills with action: "recommend", area: "flash"
  Then the tool returns an error text mentioning permission denied
  And details.recommended is absent
  And details.skills is empty

Scenario: Recommend flash skill when skillsDir is missing
  Given <cwd>/skills/ does not exist
  And the external skill ~/.pi/agent/skills/acebott-esp32-flash/SKILL.md exists
  When the agent calls robot_skills with action: "recommend", area: "flash"
  Then the external skill IS returned successfully (flash is checked first)

Scenario: Recommend when mapped local skill is absent
  Given <cwd>/skills/ exists
  And AREA_TO_SKILL["motors"] is "qd001-motors-mecanum"
  And <cwd>/skills/ does NOT contain qd001-motors-mecanum
  When the agent calls robot_skills with action: "recommend", area: "motors"
  Then the tool returns the exact error text "Skill not found for area: motors"
  And details.recommended is absent
  And details.skills is empty
  And the tool does NOT throw

Scenario: Recommend without area
  Given the agent calls robot_skills with action: "recommend" and no area
  When the tool executes
  Then it returns the error text "area is required for recommend action"
  And details.skills is an empty array
  And details.recommended is absent
  And the tool does NOT throw

Scenario: Recommend with unknown area
  Given the agent passes area: "nonexistent"
  When the schema validation runs
  Then the call is rejected by the enum constraint before execution
```

### REQ-004: `get` action

The `get` action MUST, given an exact `name`, return the full skill
entry including BOTH the raw frontmatter text AND the complete markdown
body. This distinguishes `get` from `list` (metadata only) and delivers
on the proposal's motivation of "fetch the skill so the agent can read
it without a second filesystem round-trip".

The `get` action resolves by **parsed name**, not by directory name. It
enumerates subdirectories of `<cwd>/skills/`, parses each `SKILL.md`'s
frontmatter, and matches the parsed `name` field against the requested
name. This is safe: no path concatenation with user input, no path
traversal risk. If the requested name matches the flash skill
(`acebott-esp32-flash`), the external path is checked first — no local
`ENOENT` can shadow it.

**Scenarios:**

```gherkin
Scenario: Get a known skill by name
  Given the skills directory contains qd001-servo-scan
  When the agent calls robot_skills with action: "get", name: "qd001-servo-scan"
  Then details.skills has one entry
  And entry.name is "qd001-servo-scan"
  And entry.description starts with "Use when"
  And entry.path ends with "skills/qd001-servo-scan/SKILL.md"
  And entry.frontmatter is the raw text between the --- delimiters
  And entry.body is the full markdown body of the SKILL.md (non-empty)

Scenario: Get resolves by parsed name, not directory name
  Given a subdirectory "my-skill/" contains a SKILL.md with name: "actual-name"
  When the agent calls robot_skills with action: "get", name: "actual-name"
  Then the skill IS found (matched by parsed name, not dir name)

Scenario: Get a skill where dir name differs from parsed name
  Given a subdirectory "foo/" contains a SKILL.md with name: "bar"
  When the agent calls robot_skills with action: "get", name: "bar"
  Then details.skills has one entry with name "bar"

Scenario: Get the external flash skill by name
  Given the external skill ~/.pi/agent/skills/acebott-esp32-flash/SKILL.md exists
  When the agent calls robot_skills with action: "get", name: "acebott-esp32-flash"
  Then details.skills has one entry
  And entry.name is "acebott-esp32-flash"
  And entry.path points to the user-level skills directory
  And entry.frontmatter and entry.body are populated from that file

Scenario: Get a non-existent skill
  Given the skills directory does not contain a skill named "nope"
  And no external skill named "nope" exists
  When the agent calls robot_skills with action: "get", name: "nope"
  Then the tool returns an error text "Skill not found: nope"
  And details.skills is an empty array
  And the tool does NOT throw

Scenario: Get the external flash skill when not installed
  Given the external skill ~/.pi/agent/skills/acebott-esp32-flash/SKILL.md does NOT exist
  When the agent calls robot_skills with action: "get", name: "acebott-esp32-flash"
  Then the tool returns the exact error text "External flash skill not installed: acebott-esp32-flash"
  And details.skills is empty

Scenario: Get without a name
  Given the agent calls robot_skills with action: "get" and no name
  When the tool executes
  Then it returns an error text "name is required for get action"
```

### REQ-005: Tolerant parsing (content only, unified helper)

`parseSkillDocument()` MUST never throw on malformed or missing frontmatter
**content**. It MUST degrade gracefully. Tolerance applies to file
*contents* only — operational filesystem errors (ENOENT, EACCES) are
handled by the caller per ADR-006.

This is a **unified helper**: one parsing algorithm extracts both
frontmatter and body from raw SKILL.md content. There is no separate
"frontmatter parser" and "body extractor" — `parseSkillDocument()` returns
a `ParsedSkillDocument` with `name`, `description`, `hasFrontmatter`,
`frontmatter` (raw block), and `body` (full markdown after frontmatter,
or the entire file if no frontmatter). All consumers (`scanSkills`,
`getSkillByName`, `flashEntry`) use this single function.

**Scope of tolerance:** the parser handles single-line `name:` and
`description:` values only. Multi-line YAML (block scalars `|`, folded
`>`, or continuation lines) is **out of scope** for this change — all
current skills use single-line values. If a multi-line value is
encountered, the parser takes the text after the first `description:`
prefix and does not throw; full multi-line support is a future enhancement.

**Quote stripping (RISK-003):** if a value starts AND ends with a matching
quote pair (`"` or `'`), the parser strips both quotes. This handles the
external flash skill's double-quoted `description:` and any other quoted
single-line values. Unmatched quotes (only one side) are left as-is —
tolerant degradation, never a throw.

**First-line enforcement (v2 — resolves ambiguous parsing):** frontmatter
exists ONLY if the first logical line of the document is exactly `---`.
If line 1 is not `---`, the entire raw document is `body` (`hasFrontmatter:
false`, name/description fallback). After a valid opening delimiter on
line 1, locate the next complete line equal to `---` (not a partial match
or a line containing `---` as a substring). Everything between the two
delimiters is the frontmatter block; everything after the closing delimiter
is the body. This prevents false-positive frontmatter detection on
markdown files that contain `---` as a horizontal rule mid-document.

**Scenarios:**

```gherkin
Scenario: Skill with valid frontmatter
  Given a SKILL.md with --- name: foo --- description: Use when X --- followed by body
  When parseSkillDocument parses it
  Then result.name is "foo"
  And result.description is "Use when X"
  And result.hasFrontmatter is true
  And result.frontmatter is the raw text between --- delimiters
  And result.body is the markdown content after the frontmatter block

Scenario: Skill with no frontmatter block
  Given a SKILL.md that starts with "# Some Title" (no --- block)
  When parseSkillDocument parses it
  Then result.name is the fallback name (directory name)
  And result.description is "unknown"
  And result.hasFrontmatter is false
  And result.frontmatter is ""
  And result.body is the entire file content

Scenario: Skill with --- in body but not on first line
  Given a SKILL.md that starts with "# Title" followed by "---" on line 5
  When parseSkillDocument parses it
  Then result.hasFrontmatter is false (first line is not ---)
  And result.body is the entire file content

Scenario: Skill with unterminated frontmatter
  Given a SKILL.md that starts with --- followed by name/description lines but no closing ---
  When parseSkillDocument parses it
  Then result.hasFrontmatter is false (no complete frontmatter block)
  And result.name is the fallback name (directory name)
  And result.description is "unknown"
  And result.frontmatter is ""
  And result.body is the entire file content

Scenario: Skill with frontmatter but missing description
  Given a SKILL.md with --- name: foo --- (no description key)
  When parseSkillDocument parses it
  Then result.name is "foo"
  And result.description is "unknown"
  And result.hasFrontmatter is true

Scenario: Skill with frontmatter but missing name
  Given a SKILL.md with --- description: Use when X --- (no name key)
  When parseSkillDocument parses it with fallbackName "dir-name"
  Then result.name is "dir-name"
  And result.description is "Use when X"
  And result.hasFrontmatter is true

Scenario: Skill with quoted description
  Given a SKILL.md with --- name: foo --- description: "Use when X" ---
  When parseSkillDocument parses it
  Then result.description is "Use when X" (matching quotes stripped)

Scenario: Skill with empty description value
  Given a SKILL.md with --- name: foo --- description: ---
  When parseSkillDocument parses it
  Then result.description is "unknown"

Scenario: Skill with malformed YAML
  Given a SKILL.md with --- name: foo: : broken --- garbage
  When parseSkillDocument parses it
  Then the parser does NOT throw
  And result.description is "unknown"
  And result.hasFrontmatter is true (block detected) or false (unparseable)
```

### REQ-006: Area classification (plural, explicit table)

The tool MUST classify each skill with an `areas: readonly RecommendArea[]` array
derived from an EXPLICIT `SKILL_TO_AREAS` table — NOT by parsing the skill
name heuristically and NOT by inverting `AREA_TO_SKILL` (which is
non-deterministic for aliases). A skill may serve multiple areas
(`qd001-leds-buzzer` → `["leds","buzzer"]`). Unmapped skills get `areas: []`
(an empty array IS the "unmapped" signal).

**Scenarios:**

```gherkin
Scenario: Known skill maps to its areas
  Given scanSkills returns qd001-motors-mecanum
  When the entry is built
  Then entry.areas is ["motors"]

Scenario: leds and buzzer share a skill (multi-area)
  Given scanSkills returns qd001-leds-buzzer
  When the entry is built
  Then entry.areas is ["leds", "buzzer"] (both, deterministic)
  And recommend for "leds" and for "buzzer" both return qd001-leds-buzzer

Scenario: app and web share a skill (multi-area)
  Given scanSkills returns qd001-app-control
  When the entry is built
  Then entry.areas is ["app", "web"]

Scenario: Unmapped skill gets an empty areas array
  Given a skill whose name is not in SKILL_TO_AREAS
    (e.g. esp32-connectivity, esp32-low-level-io, esp32-rtos-power)
  When scanSkills returns it
  Then entry.areas is []
  And it still appears in list results (discoverable by name)
  And recommend never returns it (no area matches an empty areas array)
```

### REQ-007: No side effects

The tool MUST be strictly read-only: it reads files under `skills/` and
returns structured data. It MUST NOT write, flash, move, or modify
anything.

**Scenarios:**

```gherkin
Scenario: Tool only reads
  Given any action (list, recommend, get)
  When the tool executes
  Then no file under skills/ is written, moved, or deleted
  And no process is spawned that mutates state
  And no hardware is accessed
```

### REQ-008: Error handling (layered, catch-all)

Error responsibility is split by layer (see ADR-006): `parseSkillDocument`
never throws on content; `scanSkills`/`getSkillByName` DO throw
operational filesystem errors; `executeSkillsAction` is the ONLY layer
that catches **all** errors and maps them to the tool's text-error
response shape. Throwing from a registered tool's `execute` crashes Pi.

`executeSkillsAction` catches: `ENOENT` → "skills directory not found",
`EACCES` → "permission denied" text, **everything else** → generic
`"Error: <msg>"` using the existing harness convention
(`err instanceof Error ? err.message : String(err)`, same as `detect.ts`).
No `safeErrorMessage` helper — the tool follows the same pass-through
pattern. The tool NEVER throws.

**Scenarios:**

```gherkin
Scenario: scanSkills surfaces EACCES; tool maps it
  Given scanSkills throws EACCES on a directory
  When executeSkillsAction runs (any action needing the dir)
  Then it catches the error
  And it returns an error text mentioning permission denied
  And details.skills is an empty array
  And the tool does NOT throw

Scenario: scanSkills surfaces ENOENT; tool maps it distinctly
  Given scanSkills throws ENOENT (directory missing)
  When executeSkillsAction runs
  Then it catches the error
  And it returns the distinct text "skills directory not found"
  (different from the empty-dir "No skills found in <path>" text)

Scenario: Unexpected error gets generic message
  Given scanSkills throws ENOTDIR or EIO or an unexpected error
  When executeSkillsAction runs
  Then it catches the error
  And it returns a generic "Error: <msg>" text (using the existing
    harness convention, same as detect.ts)
  And details.skills is an empty array
  And the tool does NOT throw

Scenario: Empty directory is NOT an error
  Given scanSkills is called on an existing but empty directory
  When it resolves
  Then it returns [] (does not throw)
  And executeSkillsAction maps [] to the "No skills found in <path>" text

Scenario: Malformed content never reaches the error path
  Given a SKILL.md with broken YAML content
  When scanSkills reads it
  Then parseSkillDocument degrades (description "unknown"), no throw
  And the entry appears in results, not in an error response

Scenario: Unknown action rejected by schema
  Given the agent passes action: "delete"
  When schema validation runs
  Then the call is rejected before execution (enum constraint)
```

## Non-Functional Requirements

### NFR-001: No new runtime dependencies

The harness MUST NOT gain any new runtime dependency for this change.
The frontmatter parser MUST be hand-rolled (no `yaml` / `gray-matter`
or any other npm dependency). Rationale: frontmatter is trivially simple
and we require tolerance over strictness. (Aligns with design ADR-001.)

### NFR-002: Performance

`list` over the current set of skills (11 at the time of this change)
SHOULD normally complete in under 50ms on a normal laptop. This is a
target, not a hard requirement — CI environments and disk I/O variance
may exceed it. No caching needed at this scale.

### NFR-003: No hardware access

The tool never touches `/dev/cu.usbserial-*`, esptool, or the robot. It
is safe to call with no robot connected.

### NFR-004: No regression

`robot_detect` and `robot_health` MUST remain unchanged in behavior and
registration. Only `index.ts` gains one additional `registerSkillsTool(pi)` call.

## Open Questions (resolved in design.md)

1. **Reason shape in `recommend`** → fixed template per area, owned by
   design.md REASONS table. (OQ-1 resolved in design.)
2. **`get` returns raw frontmatter + body** → `getSkillByName()` async
   reads the file, returning both `frontmatter` (raw block) and `body`
   (full markdown). (OQ-2 resolved in design.)
3. **`flash` external path** → `executeSkillsAction` calls `flashEntry()`
   directly for `recommend` and `get`; `recommendForArea` stays pure and
   does not handle flash. (OQ-3 resolved in design, ADR-007.)
