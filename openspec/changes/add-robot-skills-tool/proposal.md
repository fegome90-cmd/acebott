# Proposal — add-robot-skills-tool

> SDD proposal phase. Defines intent, scope, and approach for the change.

## Change

`add-robot-skills-tool` — Add a third native Pi tool (`robot_skills`) to
the existing Acebott QD001 harness that exposes the repo's `skills/`
directory as a queryable index, letting the agent (or a sub-agent)
discover, recommend, and fetch the right domain skill for a given task
area.

## Motivation

The repo ships a growing set of **domain skills** (11 at the time of this
change) covering motors, sensors, servo,
IR, LEDs, buzzer, app control, embedded review, and the ESP32 toolchain.
But the agent has no native way to answer:

- "Which skill covers servo scan sweeps?"
- "What skills are available for this robot?"
- "Give me the full SKILL.md for `qd001-motors-mecanum`."

Today the agent relies on Pi's generic skill-trigger inference, which is
not authoritative for this repo's custom skills, or it loads all skills
(context bloat), or it guesses wrong. A dedicated `robot_skills` tool
solves this by making the `skills/` directory a first-class, structured
query surface — consistent with the existing `robot_detect` and
`robot_health` tools.

## Scope

### In scope (this change)

- **1 new native tool**: `robot_skills` with actions `recommend`, `list`, `get`
- **1 new lib module**: `harness/src/lib/skills-index.ts` — scans
  `skills/`, parses skill documents (frontmatter + body via one tolerant
  helper), and classifies skills with `areas: readonly RecommendArea[]`
- **1 new tool file**: `harness/src/tools/skills.ts` — registers the tool,
  dispatches actions
- **Registration update**: `harness/src/index.ts` calls
  `registerSkillsTool(pi)` (third tool)
- **Unit tests**: `harness/tests/unit/skills.test.ts` with fixtures
  (`harness/tests/fixtures/skills/`)
- **Doc updates**: `harness/skill/SKILL.md` and `harness/README.md`
  document the new tool

### Out of scope (future changes)

- `robot_flash`, `robot_monitor`, `robot_move` tools (separate changes)
- Moving the skills into the harness package (they stay at repo-root `skills/`)
- Caching the index (re-scan every call; 11 files is cheap)
- Fuzzy / semantic skill matching (exact `area` enum only)
- Editing or creating skills (read-only tool)
- Auto-loading a recommended skill into context (the tool returns paths;
  the agent decides whether to `read` them)

## Approach

### Architecture

The tool sits alongside the existing two, reusing the same Pi extension
API and the same `index.ts` factory:

```
┌─────────────────────────────────────────────────┐
│  Pi Agent (LLM)                                 │
│     calls robot_skills to find the right skill  │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  harness/src/index.ts (extension factory)       │
│     registers robot_detect, robot_health,       │
│     robot_skills via pi.registerTool()          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  harness/src/tools/skills.ts                    │
│     dispatches list / recommend / get           │
│     (param validation, action routing)          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  harness/src/lib/skills-index.ts                │
│     scanSkills(), recommendForArea(),           │
│     getSkillByName() — tolerant frontmatter parser   │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  Filesystem: <cwd>/skills/*/SKILL.md            │
└─────────────────────────────────────────────────┘
```

### Tool contract

`robot_skills` parameters:

- `action`: `"recommend" | "list" | "get"` (required)
- `area`: optional enum for `recommend` —
  `"motors" | "sensors" | "servo" | "ir" | "leds" | "buzzer" | "app" |
   "embedded" | "esp32" | "flash" | "web"`
- `name`: optional string for `get` — exact skill name

Actions:

- **`list`**: returns every skill in `skills/` with `{ name, path, description, areas }`
- **`recommend`**: given `area`, returns the recommended skill + reason + path;
  the recommended entry also appears in `details.skills`
- **`get`**: given `name`, returns the full entry including raw frontmatter AND body

Output shape:

```json
{
  "skills": [
    { "name": "...", "path": "...", "description": "...", "areas": ["..."] }
  ],
  "recommended": { "name": "...", "path": "...", "reason": "..." }
}
```

### Area mapping (explicit table)

| area       | skill                       |
| ---------- | --------------------------- |
| `motors`   | `qd001-motors-mecanum`      |
| `sensors`  | `qd001-sensors`             |
| `servo`    | `qd001-servo-scan`          |
| `ir`       | `qd001-ir-remote`           |
| `leds`     | `qd001-leds-buzzer`         |
| `buzzer`   | `qd001-leds-buzzer`         |
| `app`      | `qd001-app-control`         |
| `web`      | `qd001-app-control`         |
| `embedded` | `embedded-systems-engineering` |
| `esp32`    | `esp32-arduino-development` |
| `flash`    | `acebott-esp32-flash` (external path) |

### Tolerant skill document parser

Hand-rolled (no YAML dependency). Rules:

- Extract block between first two `---` lines
- `name:` and `description:` via tolerant line-prefix match
- Missing block / missing keys → degrade gracefully (dir name, "unknown")
- Malformed YAML → never throw; degrade
- Extra keys ignored

## Rollback Plan

The change is additive and isolated:

- Revert `harness/src/index.ts` to register only 2 tools
- Delete `harness/src/tools/skills.ts`, `harness/src/lib/skills-index.ts`,
  `harness/tests/unit/skills.test.ts`, fixtures
- No effect on `robot_detect` / `robot_health`
- No effect on the `skills/` directory (read-only)

## Success Criteria

1. `pi.registerTool` succeeds for `robot_skills` (visible in `/tools`)
2. `list` returns all skills currently in `skills/` with correct paths
3. `recommend("motors")` returns `qd001-motors-mecanum` with a reason
4. `get("qd001-servo-scan")` returns the full frontmatter AND body
5. Missing frontmatter degrades to `description: "unknown"`, not a crash
6. All unit tests pass (`pnpm test`), no hardware access
7. `robot_detect` and `robot_health` unchanged (no regression)

## Next Steps

Proceed to **spec** phase to define formal requirements and Given/When/Then
scenarios for each action.
