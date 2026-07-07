# Tasks: Add Repo-Wide Lint Configuration

## Phase 1 — Infrastructure

### 1.1 Create `.editorconfig` at repo root
- [ ] Add root=true, [*] section with lf, utf-8, final newline
- [ ] Add [*.{ts,js,json,yaml,yml}] with tab indent
- [ ] Add [*.md] with trim_trailing_whitespace=false
- [ ] Add [Makefile] with tab indent

### 1.2 Install markdownlint-cli2
- [ ] `pnpm add -D markdownlint-cli2` in harness/
- [ ] Verify binary available via `npx markdownlint-cli2 --help`

## Phase 2 — Configuration

### 2.1 Create `.markdownlint-cli2.jsonc` at repo root
- [ ] Set default=true
- [ ] Disable MD013 (line-length)
- [ ] Disable MD033 (no-inline-html)
- [ ] Configure MD024 siblings_only=true
- [ ] Add ignores: .llm-wiki/, Español/, ACECode*/, node_modules/
- [ ] Enable gitignore=true

### 2.2 Create `.yamllint.yaml` at repo root
- [ ] extends: default
- [ ] line-length max=120 level=warning
- [ ] comments-indentation: disable
- [ ] truthy: disable
- [ ] document-start: disable

### 2.3 Add npm scripts to harness/package.json
- [ ] "lint:md": "markdownlint-cli2 '**/*.md'"
- [ ] "fix:md": "markdownlint-cli2 --fix '**/*.md'"
- [ ] "lint:yaml": "cd .. && yamllint YAMLFiles"

## Phase 3 — Gating

### 3.1 Extend lefthook.yml
- [ ] Add markdown-lint command (glob: "**/*.md", run: markdownlint-cli2)
- [ ] Add yaml-lint command (glob: "*.{yaml,yml}", run: yamllint)
- [ ] Both parallel with existing biome-lint and tsc-check

### 3.2 Verify all gates pass
- [ ] lefthook run pre-commit with clean state
- [ ] lefthook run pre-commit with intentional .md error → blocks
- [ ] lefthook run pre-commit with intentional .yaml error → blocks

## Phase 4 — Validation

### 4.1 Run all existing checks
- [ ] pnpm lint (biome)
- [ ] pnpm build (tsc)
- [ ] pnpm test (vitest)

### 4.2 Run new linters
- [ ] pnpm lint:md — all .md files pass
- [ ] pnpm lint:yaml — all .yaml files pass

### 4.3 Save to Engram
- [ ] Session summary with discoveries
