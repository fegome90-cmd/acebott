# Apply Prompt — add-robot-skills-tool

> Copy this prompt into a new Pi session to start the apply phase.

---

## Context Recovery

```bash
memory_search("add-robot-skills-tool ready for apply")
```

Then read these files in order:

1. `openspec/changes/add-robot-skills-tool/tasks.md` — implementation checklist (THE source of truth)
2. `openspec/changes/add-robot-skills-tool/design.md` — contracts, ADRs, error matrix
3. `openspec/changes/add-robot-skills-tool/spec.md` — requirements and scenarios
4. `openspec/changes/add-robot-skills-tool/proposal.md` — scope and rationale

## Prerequisite Status

`fix-harness-serial-parse` is **RESOLVED** — `serial.ts` bug fixed, `tsc --noEmit` passes clean.

## What This Change Does

Adds a 3rd native Pi tool `robot_skills` to the Acebott QD001 harness. The tool exposes the `skills/` directory as a queryable index with 3 actions: `recommend`, `list`, `get`.

## Files to Create/Modify

### New files
- `harness/src/lib/skills-index.ts` — core lib (types, parser, scanSkills, getSkillByName, recommendForArea, flashEntry)
- `harness/src/tools/skills.ts` — tool registration and dispatch
- `harness/tests/unit/skills.test.ts` — unit tests
- `harness/tests/fixtures/skills/` — 15 test fixtures

### Modified files
- `harness/src/index.ts` — add import + registerSkillsTool(pi) call

### Do NOT modify
- `harness/src/tools/detect.ts` — unchanged
- `harness/src/tools/health.ts` — unchanged
- `harness/src/lib/serial.ts` — unchanged (prerequisite already fixed)

## Key Contracts (from design.md)

### Types
```typescript
type RecommendArea = "motors" | "sensors" | "servo" | "ir" | "leds" | "buzzer"
  | "app" | "embedded" | "esp32" | "flash" | "web";

type LocalRecommendArea = Exclude<RecommendArea, "flash">;

interface SkillEntry {
  name: string;
  path: string;
  description: string;
  areas: readonly RecommendArea[];
  hasFrontmatter: boolean;
  frontmatter?: string;  // get-only
  body?: string;         // get-only
}

interface SkillsResult {
  skills: SkillEntry[];
  recommended?: { name: string; path: string; reason: string };
}

interface SkillsToolResponse {
  content: Array<{ type: "text"; text: string }>;
  details: SkillsResult;
}
```

### StringEnum (typebox 0.34 doesn't have it)
```typescript
const StringEnum = <const T extends readonly string[]>(values: T) =>
  Type.Unsafe<T[number]>({ type: "string", enum: [...values] });
```

### Parser: First-line enforcement
- Frontmatter exists ONLY if first logical line is exactly `---`
- If line 1 is not `---` → entire document is body (hasFrontmatter: false)
- Unterminated (open `---` without close) → hasFrontmatter: false, body = entire raw
- Quote stripping: matching `"value"` or `'value'` → strip quotes

### Flash error matrix

| Operation | Condition | Result |
|-----------|-----------|--------|
| recommend flash | ENOENT | `"External flash skill not installed: acebott-esp32-flash"` |
| get flash | ENOENT | `"External flash skill not installed: acebott-esp32-flash"` |
| recommend flash | EACCES | `"Permission denied while reading external flash skill"` |
| get flash | EACCES | `"Permission denied while reading external flash skill"` |
| recommend flash | EIO/other | `"Error: <msg>"` (generic) |
| get flash | EIO/other | `"Error: <msg>"` (generic) |
| recommend | entry:null | `"Skill not found for area: <area>"` |
| get | null | `"Skill not found: <name>"` |

### getSkillByName per-entry ENOENT
- Per-entry ENOENT (SKILL.md disappears): skip and continue
- Root readdir ENOENT (skillsDir missing): propagate
- Per-entry EACCES/EIO: propagate
- Sorts directory names alphabetically before duplicate resolution

### flashEntry: try-read, no existsSync
```typescript
async function flashEntry(): Promise<SkillEntry | null> {
  const p = path.join(os.homedir(), ".pi/agent/skills/acebott-esp32-flash/SKILL.md");
  let raw: string;
  try {
    raw = await fs.promises.readFile(p, "utf-8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error; // EACCES, EIO — propagate to executeSkillsAction
  }
  const doc = parseSkillDocument(raw, "acebott-esp32-flash");
  return { name: doc.name, path: p, description: doc.description,
           areas: ["flash"], hasFrontmatter: doc.hasFrontmatter,
           frontmatter: doc.frontmatter, body: doc.body };
}
```

### isNodeError: local helper, NOT exported
```typescript
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
```

### Tool registration
```typescript
export function registerSkillsTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "robot_skills",
    label: "Robot Skills",
    description: "Discover and fetch domain skills for Acebott QD001",
    parameters: Type.Object({
      action: StringEnum(["recommend", "list", "get"]),
      area: Type.Optional(StringEnum([
        "motors", "sensors", "servo", "ir", "leds", "buzzer",
        "app", "embedded", "esp32", "flash", "web",
      ])),
      name: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      const result = await executeSkillsAction({
        ...params,
        cwd: ctx.cwd,  // NOT process.cwd()
      });
      return result;
    },
  });
}
```

## Implementation Order (from tasks.md)

1. **Phase 1**: `skills-index.ts` — all types, tables, parser, scanSkills, getSkillByName, recommendForArea, flashEntry
2. **Phase 2**: `tools/skills.ts` — StringEnum, tool schema, executeSkillsAction dispatch, registerSkillsTool
3. **Phase 3**: Tests + fixtures — 15 fixtures, 11 test suites
4. **Phase 4**: Registration + docs — index.ts update, skill/SKILL.md, README.md
5. **Phase 5**: Verify — pnpm test, pnpm build, manual reload

## Test Fixtures (15 total)

```
harness/tests/fixtures/skills/
├── valid/SKILL.md
├── no-frontmatter/SKILL.md          ← has --- in body (line 5) for first-line test
├── missing-desc/SKILL.md
├── missing-name/SKILL.md
├── malformed/SKILL.md
├── unmapped/SKILL.md
├── quoted-desc/SKILL.md
├── unmatched-quote/SKILL.md
├── empty-desc/SKILL.md
├── unterminated-frontmatter/SKILL.md
├── README.md                        ← non-directory entry (skipped)
├── notes/                           ← dir without SKILL.md (skipped)
├── foo/SKILL.md                     ← name-mismatch (dir=foo, name=bar)
├── dup-a/SKILL.md                   ← duplicate name
└── dup-b/SKILL.md                   ← duplicate name
```

## 4 Low Editorial Items (non-blocking)

1. Phase 1.2: "flashEntry throws on read failure" → "flashEntry propagates EACCES/EIO; executeSkillsAction maps them"
2. Tasks 3.10: Add "assert frontmatter and body populated for successful external get"
3. scanSkills: Secondary sort by path for full determinism: `a.name.localeCompare(b.name) || a.path.localeCompare(b.path)`
4. ADR-001: "first two lines equal to ---" → "first line must be ---"

## Build Commands

```bash
cd harness
pnpm build          # tsc --noEmit — must be 0 errors
pnpm test           # vitest — all tests must pass
```

## Verification Checklist (Phase 5)

- [ ] `pnpm test` — all unit tests pass
- [ ] `pnpm build` — 0 type errors
- [ ] Manual: `/reload` Pi, `/tools` shows 3 tools
- [ ] Manual: `robot_skills list` returns all skills with correct areas
- [ ] Manual: `robot_skills recommend motors` returns qd001-motors-mecanum
- [ ] Manual: `robot_skills get qd001-servo-scan` returns frontmatter + body

## Important Notes

- Skills live at repo-root `skills/`, NOT in harness
- Flash skill is external at `~/.pi/agent/skills/acebott-esp32-flash/`
- No new npm dependencies — parser is hand-rolled
- `executeSkillsAction` is the SINGLE FS authority (ADR-007)
- `recommendForArea` is pure (no FS access)
- Tool NEVER throws — all errors become text responses
- `cwd` comes from `ctx.cwd`, NOT `process.cwd()`
