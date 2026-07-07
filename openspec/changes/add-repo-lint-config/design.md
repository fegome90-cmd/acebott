# Design: Add Repo-Wide Lint Configuration

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Lefthook pre-commit                 │
│  parallel: true                                 │
│                                                 │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────┐ │
│  │  biome   │ │   tsc    │ │ md-lint│ │yaml  │ │
│  │ --staged │ │ --noEmit │ │ staged │ │lint  │ │
│  └──────────┘ └──────────┘ └────────┘ └──────┘ │
│       │             │           │          │     │
│       ▼             ▼           ▼          ▼     │
│   harness/*.ts  harness/*.ts  *.md     *.yaml   │
└─────────────────────────────────────────────────┘

Layer 0: .editorconfig (universal, no CLI needed)
Layer 1: Biome + tsc (harness/ — existing)
Layer 2: markdownlint-cli2 (*.md — new)
Layer 3: yamllint (*.yaml — new)
```

## Technical Decisions

### 1. markdownlint-cli2 over markdownlint-cli

**Decision**: Use `markdownlint-cli2` (not `markdownlint-cli`)

**Rationale**:
- `markdownlint-cli2` supports JSONC config (comments in config)
- Native `gitignore` support
- Better glob handling
- Active maintenance (DavidAnson)

**Tradeoff**: Slightly larger npm dependency, but it's a devDep only.

### 2. yamllint via brew, not npm

**Decision**: Install `yamllint` via brew/pip, not as npm wrapper

**Rationale**:
- yamllint is a Python tool — npm wrappers add unnecessary Node layer
- brew install is one command, already have brew for lefthook
- `uvx yamllint` is also an option if uv is available

**Tradeoff**: Adds a non-Node dependency. But yamllint is the de facto YAML linter.

### 3. EditorConfig at repo root (not harness/)

**Decision**: `.editorconfig` at repo root with `root = true`

**Rationale**:
- EditorConfig is universal — editors auto-discover it
- Placing at root means ALL files benefit (skills, docs, firmware)
- `harness/` Biome config already enforces tab/100-width for TS

**Tradeoff**: May conflict with existing editor settings. But EditorConfig is designed to be the baseline, not the override.

### 4. Lefthook globs for staged files

**Decision**: Each linter uses `glob` to match file types

**Rationale**:
- Lefthook `glob` filters staged files before running command
- Markdown: `**/*.md`
- YAML: `*.{yaml,yml}` (root only, not harness/)
- Each command skips gracefully if no matching files

### 5. Config file locations

| File | Location | Why |
|------|----------|-----|
| `.editorconfig` | Repo root | Universal discovery |
| `.markdownlint-cli2.jsonc` | Repo root | Markdown files are at root level |
| `.yamllint.yaml` | Repo root | YAML files are at root level |

## File Changes

### New Files

1. **`.editorconfig`** — INI format, root=true, sections for all files, TypeScript, Markdown, Makefile
2. **`.markdownlint-cli2.jsonc`** — JSONC, default=true, MD013 off, MD033 off, ignores for .llm-wiki/ and Español/
3. **`.yamllint.yaml`** — YAML, extends default, line-length 120 warning, comments-indentation off

### Modified Files

4. **`lefthook.yml`** — Add `markdown-lint` and `yaml-lint` commands to pre-commit
5. **`harness/package.json`** — Add `lint:md`, `fix:md`, `lint:yaml` scripts + markdownlint-cli2 devDep

## Expected Output

```
$ pnpm lint:md
markdownlint-cli2 '**/*.md'
.historical/acebott-course/...  MD032  Expected blank line after heading
AGENTS.md  OK
harness/README.md  OK
...

$ pnpm lint:yaml
yamllint *.yaml *.yml
openspec/config.yaml  OK
lefthook.yml  OK
...

$ lefthook run pre-commit
┃ markdown-lint ❯
Checked 29 files. No fixes applied.
┃ yaml-lint ❯
Passed
┃ biome-lint ❯
Checked 21 files. No fixes applied.
┃ tsc-check ❯
summary: (done in 1.2 seconds)
```
