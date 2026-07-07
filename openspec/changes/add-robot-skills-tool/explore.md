# Explore — add-robot-skills-tool

> ⚠️ **Superseded investigation artifact.** This file records early
> exploration and contains historical contracts that were later replaced.
> The authoritative contracts are `design.md`, `spec.md`, and `tasks.md`.

> SDD explore phase. Investigates feasibility, constraints, and design
> space before committing to a change proposal.

## Context

The Acebott QD001 repo holds a growing set of **domain skills** in `skills/`
(11 at the time of this change; the count grows over time, so this artifact
uses count-agnostic phrasing wherever possible):

- `qd001-app-control` — app/web control protocol
- `qd001-ir-remote` — IR remote control
- `qd001-leds-buzzer` — LEDs, buzzer, PWM
- `qd001-motors-mecanum` — motors & holonomic movement
- `qd001-sensors` — ultrasonic + line tracking
- `qd001-servo-scan` — pan servo & scan sweep
- `embedded-systems-engineering` — firmware review/ISR/RTOS practices
- `esp32-arduino-development` — ESP32 + arduino-cli toolchain
- `esp32-connectivity` — WiFi/Bluetooth/networking patterns (unmapped in v1)
- `esp32-low-level-io` — GPIO/PWM/ADC/timers low-level notes (unmapped in v1)
- `esp32-rtos-power` — FreeRTOS/power-management notes (unmapped in v1)
- (README at `skills/README.md`)

Each skill ships a `SKILL.md` with YAML frontmatter:

```yaml
---
name: <skill-name>
description: Use when <trigger description>...
---
```

Meanwhile, the **harness** (`harness/`) already registers 2 native Pi
tools (`robot_detect`, `robot_health`) via `harness/src/index.ts`. But
when a user (or a sub-agent) asks a domain question like "how do I do a
servo scan sweep?", the agent has **no native way to discover which skill
to load**. It either guesses, loads all of them (context bloat), or
relies on Pi's own skill trigger inference — which is not authoritative
for this repo's custom skills.

This change adds a **third native tool** `robot_skills` that exposes the
`skills/` directory as a queryable index, so the agent can `recommend`,
`list`, or `get` the right skill for a given task area.

## Goals of Explore

- Confirm the `skills/` layout and frontmatter format are stable
- Identify how the tool maps a user request to an `area` and a skill
- Define the read-only index contract (no side effects)
- Identify risks and open questions
- Confirm the Pi extension API surface for a third tool

## Findings

### 1. Skills directory layout (confirmed)

```
skills/
├── README.md
├── embedded-systems-engineering/SKILL.md
├── esp32-arduino-development/SKILL.md
├── esp32-connectivity/SKILL.md
├── esp32-low-level-io/SKILL.md
├── esp32-rtos-power/SKILL.md
├── qd001-app-control/SKILL.md
├── qd001-ir-remote/SKILL.md
├── qd001-leds-buzzer/SKILL.md
├── qd001-motors-mecanum/SKILL.md
├── qd001-sensors/SKILL.md
└── qd001-servo-scan/SKILL.md
```

Each `SKILL.md` starts with YAML frontmatter delimited by `---`. The
frontmatter always has at least `name` and `description`. Some skills
embed rich trigger detail in `description` (e.g. `qd001-servo-scan`
calls out GPIO25, WiFi timer conflict, scan timing).

### 2. Frontmatter format (exact)

```yaml
---
name: qd001-motors-mecanum
description: Use when writing or debugging Arduino sketches (.ino) that drive the Acebott QD001 ESP32 MAX motors ...
---
```

Rules observed:

- Opening `---` on line 1
- `name:` matches the directory name (not always, but conventionally)
- `description:` is a single line (may be long), starts with "Use when"
- Closing `---` terminates the block
- Body markdown follows after a blank line

Some skills may have extra keys; the parser MUST be tolerant and only
extract `name` + `description`.

### 3. Area → skill mapping

The tool exposes an `area` enum for the `recommend` action. Mapping:

| area       | skill                       | why                                                   |
| ---------- | --------------------------- | ----------------------------------------------------- |
| `motors`   | `qd001-motors-mecanum`      | holonomic movement, ACB_SmartCar_V2                   |
| `sensors`  | `qd001-sensors`             | ultrasonic + line tracking                            |
| `servo`    | `qd001-servo-scan`          | pan servo GPIO25, scan sweep                          |
| `ir`       | `qd001-ir-remote`           | IR receiver pin 4, remote codes                       |
| `leds`     | `qd001-leds-buzzer`         | LEDs (also covers buzzer)                             |
| `buzzer`   | `qd001-leds-buzzer`         | buzzer + PWM (same skill as leds)                     |
| `app`      | `qd001-app-control`         | app/web protocol, WiFi AP                             |
| `embedded` | `embedded-systems-engineering` | firmware review, ISR/RTOS                          |
| `esp32`    | `esp32-arduino-development` | ESP32 toolchain, arduino-cli                          |
| `flash`    | `acebott-esp32-flash` (external) | canonical flash workflow — NOT in skills/        |
| `web`      | `qd001-app-control`         | web-control alias for app (iOS Safari bug lives here) |

Note: `flash` maps to an external user-level skill at
`~/.pi/agent/skills/acebott-esp32-flash/`. The tool scans `skills/` at
repo root, so `flash` is a known area but the path points outside
`skills/` — the tool MUST handle this gracefully (either include it with
an absolute path marker, or document it as "external").

### 4. Pi extension API (confirmed, matches harness)

- **Registration**: `pi.registerTool({ name, label, description, parameters, execute })`
- **Schema**: `@sinclair/typebox` `Type.Object(...)` + `Type.Optional`
- **StringEnum**: from `@earendil-works/pi-ai`
- **Return shape**: `{ content: [{type:"text", text}], details: <structured> }`
- **Errors**: return text error, NEVER throw
- **Context**: `ctx.cwd` gives the project root — used to locate `skills/`

The harness already imports these; the third tool reuses the same imports.

### 5. Index module contract (`lib/skills-index.ts`)

A pure module that scans a directory and returns parsed entries:

```typescript
interface SkillEntry {
  name: string;          // frontmatter name, or dir name as fallback
  path: string;          // absolute path to SKILL.md
  description: string;   // frontmatter description, or "unknown"
  area: string;          // derived from name (see mapping)
  hasFrontmatter: boolean;
}

async function scanSkills(skillsDir: string): Promise<SkillEntry[]>;
function recommendForArea(entries: SkillEntry[], area: Area): SkillEntry | null;
function getByName(entries: SkillEntry[], name: string): SkillEntry | null;
```

Read-only. No caching needed at this scale (11 files at the time of this
change; the count grows over time). A simple `fs.readdir` + read each
`SKILL.md` + parse frontmatter.

### 6. Frontmatter parser requirements

The parser MUST be tolerant:

- If no `---` block → `hasFrontmatter: false`, use dir name as `name`,
  description "unknown"
- If `---` block but missing `name` → use dir name
- If `---` block but missing `description` → "unknown"
- If YAML is malformed → do NOT throw; degrade to name=dir, description="unknown"
- Multi-line descriptions: join into single string
- Extra keys in frontmatter: ignored, not fatal

This rules out strict YAML libraries that throw. Options:

1. **Hand-rolled regex parser**: extract the block between the first two
   `---` lines, then `name:` / `description:` via line-prefix match.
   Simplest, no deps, fully tolerant.
2. **`yaml` npm package with try/catch**: more correct for edge cases
   (quoted strings, multi-line), adds a dependency.

Recommendation: **hand-rolled** — the frontmatter is trivially simple
(two keys, single-line values) and we explicitly want tolerance over
strictness.

### 7. Testing strategy

vitest (already in the harness). Two layers:

- **Unit tests** with a fixtures directory (`tests/fixtures/skills/`)
  containing crafted `SKILL.md` files covering: valid frontmatter, no
  frontmatter, malformed YAML, missing name, missing description,
  multi-line description.
- The real `skills/` directory is NOT tested directly (it changes as the
  project grows); tests use fixtures so they are deterministic.

No integration tests / hardware needed — this tool is pure filesystem
reads, no hardware side effects.

### 8. Risks

| Risk | Mitigation |
| --- | --- |
| `skills/` dir missing or moved | Return empty list with explanatory text, never throw |
| Frontmatter format drift (new keys, comments) | Tolerant parser: only read `name` + `description`, ignore rest |
| `flash` area points outside `skills/` | Document as external; either omit from `list` or include with `path` pointing to `~/.pi/agent/skills/acebott-esp32-flash/SKILL.md` and `area: "external"` |
| Tool called outside the repo (cwd not acebott/) | Use `ctx.cwd` to resolve `skills/`; if missing, return "skills directory not found" error text |
| Duplicate skill names | First match wins; log a warning in the result text |

## Open Questions

1. **`flash` area handling**: should `recommend("flash")` return the
   external `acebott-esp32-flash` skill with an absolute path, or return
   a "not in skills/ — see user-level skill" text? Recommendation:
   include it with absolute path so the agent gets actionable info.
2. **Caching**: should the index be cached per-session, or re-scan every
   call? Recommendation: re-scan every call (11 files at the time of
   this change, < 5ms). Add cache
   only if profiling shows need.
3. **Area derivation**: should `area` be parsed from the skill name
   prefix (`qd001-motors-mecanum` → `motors`) or from an explicit
   mapping table? Recommendation: explicit mapping table (more robust,
   handles `leds`/`buzzer` overlap and `app`/`web` alias).

## Recommendation

Proceed to **proposal** phase with scope: 1 new tool (`robot_skills`),
1 new lib module (`lib/skills-index.ts`), tolerant hand-rolled
frontmatter parser, explicit area mapping table, unit tests with
fixtures. Defer caching and fuzzy matching to future changes.

## Design Refinement Note

> ⚠️ **The contracts in this explore document are superseded.**
> The findings below drove the investigation, but the design phase
> resolved several open questions that changed the data model
> substantially. **The authoritative contracts live in `design.md`
> (ADR-002 through ADR-007) and `spec.md`.** The sections below are
> preserved as a historical record of what was investigated, not as
> implementation specs.

Key changes made during design:

- **Areas are plural** (`areas: readonly RecommendArea[]`, not `area: string`):
  one skill can serve multiple areas (e.g. `qd001-leds-buzzer` →
  `["leds","buzzer"]`). Two explicit tables (`AREA_TO_SKILL` +
  `SKILL_TO_AREAS`) replace the inversion-based approach.
- **`parseSkillDocument`** replaces `parseFrontmatter` — a unified helper
  that extracts both frontmatter and body in one pass. There is no
  separate body extractor.
- **`scanSkills` throws operational errors** (ENOENT, EACCES); only
  `parseSkillDocument` is tolerant. `executeSkillsAction` catches all
  errors (including unexpected ones) and maps to text. Uses
  `readdir({ withFileTypes: true })` to skip non-directories and
  subdirectories without SKILL.md. Results sorted by name.
- **`getSkillByName` is async** and enumerates subdirectories, parsing
  each SKILL.md to match by **parsed name** (not directory name). No
  path concatenation with user input. Returns `frontmatter` + `body`.
- **`recommendForArea` uses `AREA_TO_SKILL[area]`** for deterministic
  lookup — not iteration by areas array.
- **Multiline YAML** is out of scope (M3). Single-line values only.
- **`flash` authority** lives in `executeSkillsAction` (ADR-007), not
  in `recommendForArea`. Flash is checked **before** local directory
  for both `recommend` and `get`.
- **Error handling** is catch-all: ENOENT/EACCES get specialized text,
  everything else gets `"Error: <msg>"` using the existing harness
  pass-through convention.
