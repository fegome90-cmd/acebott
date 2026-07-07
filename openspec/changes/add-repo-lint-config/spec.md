# Spec: Add Repo-Wide Lint Configuration

## RFC 2119 Keywords

The key words "MUST", "SHALL", "SHOULD", "MAY" in this document are to be interpreted as described in RFC 2119.

---

## 1. EditorConfig

### Scenario: Root EditorConfig exists

**Given** a developer opens any file in the repo
**When** their editor searches for `.editorconfig`
**Then** it SHALL find one at the repo root with `root = true`

### Scenario: TypeScript files use tabs

**Given** a `.ts` file in `harness/`
**When** the editor applies EditorConfig rules
**Then** it SHALL use tab indentation, UTF-8 charset, LF line endings, and final newline

### Scenario: Markdown preserves trailing whitespace

**Given** a `.md` file
**When** the editor applies EditorConfig rules
**Then** it SHALL NOT trim trailing whitespace (Markdown uses trailing spaces for `<br>`)

### Scenario: Makefile uses tab indentation

**Given** a `Makefile` (if one exists in the future)
**When** the editor applies EditorConfig rules
**Then** it SHALL use tab indentation

---

## 2. Markdown Lint (markdownlint-cli2)

### Scenario: markdownlint-cli2 is installed

**Given** a developer runs `pnpm install` in `harness/`
**When** installation completes
**Then** `markdownlint-cli2` SHALL be available as a devDependency

### Scenario: Config excludes non-repo directories

**Given** the `.markdownlint-cli2.jsonc` config
**When** markdownlint-cli2 scans for `.md` files
**Then** it SHALL exclude `.llm-wiki/`, `Español/`, `ACECode*/`, `node_modules/`

### Scenario: Line-length rule is disabled

**Given** a Markdown file with lines exceeding 100 characters
**When** `markdownlint-cli2` lints the file
**Then** it SHALL NOT report MD013 (line-length) violations

### Scenario: Inline HTML is allowed

**Given** a Markdown file containing `<details>`, `<summary>`, or `<br>` tags
**When** `markdownlint-cli2` lints the file
**Then** it SHALL NOT report MD033 (no-inline-html) violations

### Scenario: Script available

**Given** a developer wants to lint Markdown
**When** they run `pnpm lint:md` from `harness/`
**Then** markdownlint-cli2 SHALL scan all `.md` files in the repo (excluding configured ignores)

### Scenario: Fix mode available

**Given** a developer wants to auto-fix Markdown issues
**When** they run `pnpm fix:md` from `harness/`
**Then** markdownlint-cli2 SHALL apply safe fixes

---

## 3. YAML Lint (yamllint)

### Scenario: yamllint is available

**Given** a developer has brew or pip installed
**When** they install yamllint
**Then** `yamllint` SHALL be available on PATH

### Scenario: Config extends default

**Given** the `.yamllint.yaml` config
**When** yamllint lints YAML files
**Then** it SHALL extend the default config with relaxed line-length (120, warning)

### Scenario: Comments-indentation disabled

**Given** a YAML file with indented comments
**When** yamllint lints the file
**Then** it SHALL NOT report comments-indentation violations

### Scenario: Script available

**Given** a developer wants to lint YAML
**When** they run `pnpm lint:yaml` from `harness/`
**Then** yamllint SHALL scan `*.yaml` and `*.yml` files in the repo root

---

## 4. Lefthook Integration

### Scenario: Pre-commit runs all linters

**Given** a developer commits changes including `.md` or `.yaml` files
**When** the pre-commit hook fires
**Then** it SHALL run biome, tsc, markdownlint-cli2, and yamllint in parallel

### Scenario: Markdown lint blocks on violations

**Given** a staged `.md` file with lint errors
**When** the pre-commit hook runs
**Then** the commit SHALL be blocked with exit code != 0

### Scenario: YAML lint blocks on violations

**Given** a staged `.yaml` file with lint errors
**When** the pre-commit hook runs
**Then** the commit SHALL be blocked with exit code != 0

### Scenario: Non-matching files skip gracefully

**Given** a commit with only `.ts` changes
**When** the pre-commit hook runs
**Then** markdownlint-cli2 and yamllint commands SHALL skip (no matching staged files)

---

## 5. Existing Checks Unchanged

### Scenario: Biome still works

**Given** the new lint configuration
**When** `pnpm lint` runs
**Then** it SHALL still use `biome check --error-on-warnings`

### Scenario: TypeScript still compiles

**Given** the new lint configuration
**When** `pnpm build` runs
**Then** it SHALL still pass `tsc --noEmit` with zero errors

### Scenario: Tests still pass

**Given** the new lint configuration
**When** `pnpm test` runs
**Then** it SHALL still pass all 88 tests
