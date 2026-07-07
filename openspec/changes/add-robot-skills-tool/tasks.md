# Tasks — add-robot-skills-tool

> SDD tasks phase. Implementation breakdown.
> Phases ordered by dependency. Check off `- [x]` as completed.
>
> **Contracts align with design.md v3** (parseSkillDocument unified
> helper, safe getSkillByName by parsed name, scanSkills directory
> filtering + sorting, recommendForArea uses AREA_TO_SKILL, flash
> bifurcation first, catch-all error handling, multiline out of scope).

## Phase 1: Skills index module

- [x] 1.1 Write `harness/src/lib/skills-index.ts`:
        - Export `RecommendArea` type union (no `"other"` — unmapped = `[]`)
        - Export `LocalRecommendArea = Exclude<RecommendArea, "flash">`
          (prevents accidental flash calls at the type level — ADR-007)
        - Export `SkillEntry` interface with `areas: readonly RecommendArea[]`
          (plural, readonly array — matches `areasForName()` return type),
          `frontmatter?: string`, `body?: string` (body is get-only)
        - Export `ParsedSkillDocument` interface: `{ name, description,
          hasFrontmatter, frontmatter, body }` — unified parsing result
        - Export `AREA_TO_SKILL: Record<RecommendArea, string>` (ADR-002:
          requested area → skill; aliases are first-class)
        - Export `SKILL_TO_AREAS: Record<string, readonly RecommendArea[]>`
          (ADR-002: skill → all areas it serves; EXPLICIT table, never
          derived by inverting AREA_TO_SKILL — resolves H1)
        - Export `REASONS: Record<RecommendArea, string>` (OQ-1)
        - Export `areasForName(name): readonly RecommendArea[]` — reads
          from SKILL_TO_AREAS only; returns `[]` if unmapped
        - Export `parseSkillDocument(raw, fallbackName): ParsedSkillDocument`
          — hand-rolled, tolerant (ADR-001). **First-line enforcement:**
          frontmatter exists ONLY if the first logical line is exactly
          `---`. If line 1 is not `---`, the entire document is body
          (`hasFrontmatter: false`). After a valid opening `---` on line 1,
          locate the next complete line equal to `---` (not a substring).
          If no closing `---` is found, treat as no-frontmatter (`hasFrontmatter:
          false`, body = entire raw). Extract `name:` and `description:` via
          line-prefix match. Returns both `frontmatter` (raw block) and `body`
          (everything after FM block, or entire file if no FM). **NEVER throws**
          on content issues. Single-line values only; multiline YAML is out
          of scope (M3). **Quote stripping** (RISK-003): if a value starts
          AND ends with a matching `"` or `'` pair, strip them. This is the
          ONE parsing algorithm used by scanSkills, getSkillByName, and
          flashEntry.
        - Export `scanSkills(skillsDir): Promise<SkillEntry[]>` —
          `fs.readdir(skillsDir, { withFileTypes: true })` + skip
          non-directory entries (e.g. README.md) + skip subdirectories
          without SKILL.md + read each `<dir>/SKILL.md` + parseSkillDocument
          + areasForName. Per-file ENOENT (SKILL.md disappears between
          readdir and readFile): skip that entry. **THROWS operational
          filesystem errors** (`ENOENT` on root dir, `EACCES`) —
          executeSkillsAction catches them per ADR-006. Empty dir → `[]`
          (not an error). Results **sorted by name** for deterministic
          output. Does NOT populate frontmatter/body on returned entries
          (those are get-only fields).
        - Export `getSkillByName(skillsDir, requestedName): Promise<SkillEntry | null>`
          — **enumerates** subdirectories of skillsDir (same readdir
          approach as scanSkills), **sorts directory names alphabetically**
          before matching (deterministic duplicate handling), parses each
          SKILL.md via parseSkillDocument, and **matches by parsed name**
          (not directory name). Safe: no path concatenation with user input,
          no path traversal. **Per-entry ENOENT** (parallels scanSkills):
          if a SKILL.md disappears between readdir and readFile, skip that
          entry and continue searching. Root readdir ENOENT (skillsDir
          missing) propagates. Per-entry EACCES/EIO propagates. Returns
          entry WITH populated frontmatter and body (the ONLY function that
          does this — resolves H2). Returns null if no match (including when
          all entries were skipped). THROWS on operational FS errors. A valid
          dir with no matching skill returns null (not an error).
        - Export `recommendForArea(entries: readonly SkillEntry[], area: LocalRecommendArea): { entry, reason }`
          — **PURE** function, does NOT touch filesystem. Does NOT handle
          flash (ADR-007). Uses `AREA_TO_SKILL[area]` for **deterministic
          lookup** — finds the entry whose `name` matches the target skill.
          Does NOT iterate by areas array (finding 3 from veredicto).
          If no matching entry exists in the scanned list, returns
          `{ entry: null, reason }` (valid local area whose mapped skill
          is absent from entries).
- [x] 1.2 Export `flashEntry()` helper in `skills-index.ts` — resolves
        `~/.pi/agent/skills/acebott-esp32-flash/SKILL.md` via
        `os.homedir()` + **try-read** (NOT `existsSync` — avoids TOCTOU,
        veredicto finding 7): `fs.promises.readFile`, catch `ENOENT` → null,
        re-throw `EACCES`/`EIO`. Reads file, calls `parseSkillDocument`
        to extract frontmatter + body (unified helper, handles quoted
        description per RISK-003). Returns `SkillEntry | null`. THROWS on
        read failure: `EACCES` maps to `"Permission denied while reading
        external flash skill"`; `EIO` and other codes use `"Error: <msg>"`.
        Returns null if file missing (ENOENT — maps to
        `"External flash skill not installed: acebott-esp32-flash"`).
        The try-read single read call avoids TOCTOU by design — no
        existence check followed by a separate read.

## Phase 2: Tool registration

- [x] 2.1 Write `harness/src/tools/skills.ts`:
        - **Export `SkillsResult`** and **`SkillsToolResponse`** interfaces
          (veredicto finding 3 — prevents contract divergence between
          implementation and tests):
          `SkillsResult = { skills: SkillEntry[]; recommended?: { name; path; reason } }`
          `SkillsToolResponse = { content: Array<{type:"text";text:string}>; details: SkillsResult }`
        - Export `registerSkillsTool(pi)` — `pi.registerTool` with name
          `robot_skills`, Typebox schema (`action` enum, optional `area`
          enum, optional `name` string). **Define a local `StringEnum`
          helper** (RISK-001: typebox 0.34 has no built-in StringEnum):
          `const StringEnum = <const T extends readonly string[]>(v: T) => Type.Unsafe<T[number]>({ type: "string", enum: [...v] })`.
          Use `<const T extends readonly string[]>` + `[...values]` to
          preserve literal union inference (veredicto finding 4).
          Place it at the top of `tools/skills.ts`.
        - Export `executeSkillsAction({ action, area, name, cwd })`:
          params typed as `area?: RecommendArea` (NOT `string` — veredicto
          finding 2: schema validation doesn't replace exported function
          typing; tests call this directly). Returns `Promise<SkillsToolResponse>`.
          This is the **single filesystem authority** (ADR-007). It owns:
          - **Catch-all error handling** (finding 6): catches ALL errors,
            not just ENOENT/EACCES. Specific codes get specialized text;
            everything else gets `"Error: <msg>"` using the **existing harness
            convention** (`err instanceof Error ? err.message : String(err)`,
            same as detect.ts). **No `safeErrorMessage` helper** — follow
            the pass-through pattern. The tool NEVER throws.
          - **Flash bifurcation first** (finding 4): for both `recommend`
            and `get`, flash is checked BEFORE local directory. Missing
            skillsDir cannot shadow the external skill.
          - `list`: obtains `cwd` from the Pi execute context (`ctx.cwd` or
            equivalent), **not `process.cwd()`** (RISK-F1). Calls
            `scanSkills(cwd/skills)`, strips `frontmatter`/`body`
            from entries, returns metadata only. Error mapping catches all.
          - `recommend`: **requires `area`** — if absent, returns
            `"area is required for recommend action"` error text (M4).
            **Flash first**: if `area === "flash"`, calls `flashEntry()`
            directly (no local scan). Strips frontmatter/body from the
            returned entry (get-only fields). Otherwise calls `scanSkills`
            then `recommendForArea(entries, area)` (deterministic lookup
            via AREA_TO_SKILL). If entry is null, returns exact error text
            `"Skill not found for area: <area>"`, omits `recommended`, and
            returns empty `details.skills`. If found, includes the single
            matching entry in `details.skills`.
          - `get`: **requires `name`** — if absent, returns
            `"name is required for get action"` error text. **Flash first**:
            if `name === "acebott-esp32-flash"`, calls `flashEntry()`
            directly. Otherwise calls `getSkillByName(cwd/skills, name)`.
            Returns entry with frontmatter + body in `details.skills`.
- [x] 2.2 Update `harness/src/index.ts`:
        - Add `import { registerSkillsTool } from "./tools/skills.js"`
        - Add `registerSkillsTool(pi)` call inside the factory (after
          the existing two registrations)
        - Add re-exports for `executeSkillsAction`, `scanSkills`,
          `getSkillByName`, `SkillEntry`, `RecommendArea`, `SkillsResult`,
          `SkillsToolResponse` for testing

## Phase 3: Unit tests + fixtures

- [x] 3.1 Create fixture `harness/tests/fixtures/skills/valid/SKILL.md`
        with well-formed frontmatter (name + description, both single-line)
- [x] 3.2 Create fixture `.../no-frontmatter/SKILL.md` starting with
        `# Title` (no `---` on line 1). Include a `---` horizontal rule
        on line 5 to verify first-line enforcement: the `---` in body
        does NOT trigger frontmatter detection.
- [x] 3.3 Create fixture `.../missing-desc/SKILL.md` with frontmatter
        that has `name:` but no `description:`
- [x] 3.3b Create fixture `.../missing-name/SKILL.md` with frontmatter
        that has `description:` but no `name:`. Asserts fallback name =
        directory name.
- [x] 3.4 Create fixture `.../malformed/SKILL.md` with broken YAML
        (`name: foo: : broken`)
- [ ] 3.5 ~~Create fixture `.../multiline-desc/SKILL.md`~~ **REMOVED:**
        multiline YAML is out of scope (M3). Drop the fixture and all
        multiline test assertions.
- [x] 3.6 Create fixture `.../unmapped/SKILL.md` with VALID frontmatter
        using a `name:` that is NOT present in SKILL_TO_AREAS (e.g.
        `name: some-future-skill`). Covers the `areas: []` branch
        (REQ-006 scenario "Unmapped skill gets empty areas array").
- [x] 3.6b Create fixture `.../quoted-desc/SKILL.md` with a DOUBLE-QUOTED
        description mirroring the real flash skill shape (RISK-003):
        `description: "Use when something needs X."` plus extra nested
        frontmatter keys (`metadata:` with nested `triggers:`). Asserts
        `parseSkillDocument` strips the matching quote pair and ignores
        unknown keys.
- [x] 3.6c Create parser edge fixtures for tolerant behavior:
        `unmatched-quote/SKILL.md` (one-sided quote stays as-is) and
        `empty-desc/SKILL.md` (`description:` with no value resolves to
        `"unknown"`). CRLF/BOM is documented as deferred/out-of-scope.
  - [x] 3.6d Create `.../unterminated-frontmatter/SKILL.md` — starts with
        `---` (valid opening) but never has a closing `---`. Asserts
        `parseSkillDocument` returns `hasFrontmatter: false`, body = entire
        raw content, name/description fallback to defaults.
- [x] 3.7 Create a **non-directory** entry in fixtures: a file
        `harness/tests/fixtures/skills/README.md` (plain file, not a dir).
        Verifies scanSkills skips non-directory entries (REQ-002).
- [x] 3.8 Create a **dir-without-SKILL.md** fixture:
        `harness/tests/fixtures/skills/notes/` (empty dir or with a
        non-SKILL.md file). Verifies scanSkills skips dirs without SKILL.md.
- [x] 3.9 Create a **name-mismatch** fixture: directory named `foo/`
        containing a SKILL.md with `name: bar` in frontmatter. Verifies
        getSkillByName matches by parsed name, not directory name (finding 1).
- [x] 3.9b Create a **duplicate-names** fixture pair: `dup-a/SKILL.md`
        and `dup-b/SKILL.md`, both with `name: same-name`. Verifies
        getSkillByName returns the alphabetically-first dir's entry
        (dup-a) deterministically (veredicto finding 6).
- [x] 3.10 Write `harness/tests/unit/skills.test.ts` covering:
        - **Table invariant** (veredicto finding 8): assert every
          `AREA_TO_SKILL[area]` maps to a skill whose `SKILL_TO_AREAS`
          contains that area, and every `REASONS[area]` mentions the
          mapped skill name. Exception: `flash` maps to an external
          skill NOT in SKILL_TO_AREAS (document this explicitly).
        - **Composition smoke test** (RISK-004): import the `index.ts`
          factory, call with a mock `pi`, assert `registerTool` called
          exactly 3× without throwing.
        - **parseSkillDocument**: valid, no-frontmatter (including ---
          in body but not on line 1), missing-name, missing-desc,
          malformed (no throw), quoted-desc (strip matching quotes),
          unmatched-quote (leave as-is), empty-desc (`"unknown"`),
          unterminated-frontmatter (opening --- without closing --- →
          hasFrontmatter: false, body = entire raw).
          First-line enforcement: a file starting with "# Title" followed
          by --- on line 5 must NOT be detected as frontmatter.
          Body extraction: valid FM → body is content after FM block;
          no FM → body is entire file. All single-line values.
        - **scanSkills**: returns all fixture entries, missing dir → throws
          ENOENT, empty dir → `[]` (no throw), `unmapped` fixture →
          `areas: []`, known fixtures → correct `areas` arrays. Skips
          non-directory entries (README.md). Skips dirs without SKILL.md
          (notes/). Skips per-file ENOENT if a SKILL.md disappears between
          readdir and readFile (TOCTOU). Results sorted by name.
        - **areasForName**: known name → its areas array; unknown name → `[]`;
          qd001-leds-buzzer → `["leds","buzzer"]` (multi-area, deterministic);
          the 3 real esp32-* sub-skills → `[]` (per ADR-002 Scope Note)
        - **getSkillByName**: found → returns entry with populated
          `frontmatter` (raw block) AND `body` (full markdown, non-empty);
          not found → returns null; throws on EACCES. Name-mismatch fixture:
          getSkillByName(skillsDir, "bar") finds the entry even though dir
          is named "foo/" (finding 1). Duplicate-names fixture:
          getSkillByName(skillsDir, "same-name") returns dup-a (finding 6).
          Per-entry ENOENT: if a SKILL.md disappears between readdir and
          readFile, that entry is skipped and search continues (returns null
          if no match found, NOT an error). Root readdir ENOENT (skillsDir
          missing) still propagates.
        - **recommendForArea**: known area (LocalRecommendArea, excludes
          flash) returns entry + reason via AREA_TO_SKILL lookup (not
          iteration); two entries with same area → always returns the one
          in AREA_TO_SKILL (deterministic, finding 3); valid local area
          whose mapped skill is absent from entries → `{ entry: null, reason }`.
          Does NOT test flash (flash is executeSkillsAction's responsibility
          per ADR-007). Type-level: recommendForArea(entries, "flash") must
          NOT compile.
        - **executeSkillsAction** `list` / `recommend` / `get` dispatch:
          missing dir → ENOENT mapped to "skills directory not found" text;
          empty dir → "No skills found in <path>" text; EACCES → permission denied;
          unexpected error (ENOTDIR, EIO) → generic "Error: <msg>" (pass-through);
          `recommend` without area → "area is required" error;
          `recommend` with valid area but mapped skill absent → exact
          "Skill not found for area: <area>" error with empty skills;
          `get` without name → "name is required" error; `recommend`
          with `flash` area → external entry or exact
          "External flash skill not installed: acebott-esp32-flash" error;
          `get` with `name: "acebott-esp32-flash"` → external entry or
          "External flash skill not installed: acebott-esp32-flash" error;
          flash EACCES → permission denied error (both recommend and get);
          flash when skillsDir missing → flash still works;
          `recommend` flash entry has no frontmatter/body in details.skills;
          no-throw on all error paths
- [x] 3.11 Run `pnpm test` — all unit tests pass, 0 hardware access,
        `robot_detect` / `robot_health` tests still green (no regression)

## Phase 4: Documentation

- [x] 4.1 Update `harness/skill/SKILL.md`:
        - Add `robot_skills` to the tools section
        - Document the three actions (`list`, `recommend`, `get`)
        - Document the area enum and alias behavior (leds/buzzer, app/web)
        - Note that the tool reads `<cwd>/skills/` (repo-root, not the
          harness package)
        - Note `flash` resolves to the external user-level skill
        - Note `get` returns full SKILL.md body (not just metadata)
- [x] 4.2 Update `harness/README.md`:
        - Add `robot_skills` to the tools list
        - Add a short usage example (list / recommend / get)
        - Note no hardware access required for this tool

## Phase 5: Verify (post-implementation gate)

- [x] 5.1 Run `pnpm test` — all unit tests pass
- [x] 5.2 Run `pnpm build` (`tsc --noEmit`) — 0 type errors
- [x] 5.3 Manual: `/reload` Pi, confirm `/tools` shows `robot_skills`
        alongside the existing two (no regression)
- [x] 5.4 Manual: call `robot_skills` `list` from Pi against the real
        `skills/` dir, confirm entry count matches current skill subdirs
        with correct paths and `areas` arrays, results sorted by name
- [x] 5.5 Manual: call `recommend` for `motors` and `buzzer`, confirm
        correct skill + reason; confirm the recommended entry also appears
        in `details.skills` without frontmatter/body
- [x] 5.6 Manual: call `get` for `qd001-servo-scan`, confirm raw
        frontmatter AND full body are returned

## Implementation Note

Implementation deferred — will be done in a follow-up session. The
harness currently registers 2 tools; this change adds a 3rd
(`robot_skills`) and requires updating `harness/src/index.ts`.

Specifically, the following code changes are NOT part of this planning
artifact and will be executed separately:

- Creating `harness/src/lib/skills-index.ts` (with `RecommendArea`,
  `ParsedSkillDocument`, `parseSkillDocument`, `SKILL_TO_AREAS`,
  `getSkillByName` (safe lookup by parsed name), `flashEntry`,
  `scanSkills` (directory filtering + sorting), `recommendForArea`
  (deterministic via AREA_TO_SKILL))
- Creating `harness/src/tools/skills.ts` (with `executeSkillsAction`
  as the single FS authority, catch-all error handling, flash bifurcation)
- Editing `harness/src/index.ts` (add import + `registerSkillsTool(pi)`)
- Creating `harness/tests/unit/skills.test.ts` and fixtures
  (no multiline fixture; unmapped fixture for areas: [];
  non-directory and dir-without-SKILL.md fixtures; name-mismatch fixture)
- Editing `harness/skill/SKILL.md` and `harness/README.md`

**Prerequisite:** `fix-harness-serial-parse` — **RESOLVED** (serial.ts bug
fixed; `tsc --noEmit` passes clean; harness loads). No longer a blocker.
