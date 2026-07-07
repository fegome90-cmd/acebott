# Proposal: Add Repo-Wide Lint Configuration

## Intent

The `harness/` has Biome + Lefthook protecting TypeScript, but 29 Markdown files, 3 YAML files, and the root have zero linting. No `.editorconfig` exists. This creates inconsistent formatting across editors and no baseline for non-TS files.

## Scope

### In Scope
- `.editorconfig` at repo root — universal baseline (0 deps)
- `markdownlint-cli2` for 29 `.md` files — config + npm script + lefthook gate
- `yamllint` for 3 `.yaml/.yml` files — config + brew/pip install
- Extend Lefthook pre-commit to include new linters

### Out of Scope
- `clang-format` for `.ino` (23 Arduino sketches) — these are course reference files, not actively modified
- Python linting (no `.py` files tracked)
- JSON linting (Biome already covers `harness/` JSON; root JSON is minimal)

## Approach

1. Add `.editorconfig` at repo root (universal, zero-cost)
2. Add `markdownlint-cli2` as devDep in `harness/`, create `.markdownlint-cli2.jsonc`
3. Add `yamllint` via brew (or pip), create `.yamllint.yaml` at root
4. Extend `lefthook.yml` pre-commit to run all three linters
5. Add npm scripts in `harness/package.json` for `lint:md` and `lint:yaml`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `.editorconfig` | New | Repo-wide editor defaults |
| `.markdownlint-cli2.jsonc` | New | Markdown lint rules |
| `.yamllint.yaml` | New | YAML lint rules |
| `lefthook.yml` | Modified | Add markdown + yaml gates |
| `harness/package.json` | Modified | Add lint:md, lint:yaml scripts |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| markdownlint fires on `.llm-wiki/` or `Español/` | High | Exclude in `.markdownlint-cli2.jsonc` ignores |
| yamllint not available via brew | Low | Use `pip install yamllint` or `uvx yamllint` |
| Lefthook pre-commit becomes slow | Low | All linters are fast (<1s each); parallel execution |

## Rollback Plan

Remove added files and revert `lefthook.yml` / `package.json` changes. No data migration needed.

## Dependencies

- `markdownlint-cli2` (npm devDep)
- `yamllint` (brew or pip)
- `lefthook` (already installed)

## Success Criteria

- [ ] `.editorconfig` recognized by VS Code / IntelliJ
- [ ] `markdownlint-cli2` catches broken links, inconsistent headings in `.md` files
- [ ] `yamllint` catches syntax errors in YAML configs
- [ ] Lefthook pre-commit blocks commits with lint violations
- [ ] All existing checks still pass (biome, tsc, vitest)
