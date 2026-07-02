# Proposal — fix-skills-audit

> SDD proposal for fixing audit findings in the 2 active skills.

## Change

`fix-skills-audit` — Correct audit findings in `esp32-arduino-development`
and `embedded-systems-engineering` identified during the 2026-07-02 audit.

## Motivation

The skills were curated from external sources but contain residual issues
that reduce accuracy and alignment with the Acebott QD001 project:

- **Contradictions** with project Critical Rules (arduino-cli upload)
- **Incorrect environment** assumptions (Linux ports, Windows install)
- **Missing project-specific context** (ACB_SmartCar_V2, QD001 FQBN marker)
- **Corrupted content** (Chinese characters from copy-paste)
- **Dead reference material** (ecosystem table, Snyk Code promo)

## Scope

### In scope

- Fix `esp32-arduino-development/SKILL.md` (7 findings)
- Fix `embedded-systems-engineering/SKILL.md` (4 findings)
- No new skills created
- No structural changes to repo

### Out of scope

- Creating `acebott-qd001-patterns` (future change)
- Rewriting skill from scratch (incremental fixes only)
- External skill `acebott-esp32-flash` (already validated)

## Findings to Fix

### esp32-arduino-development (7 findings)

| # | Finding | Fix |
|---|---------|-----|
| 1 | Contradicts Critical Rule #1 (shows `arduino-cli upload` as flash method) | Add project note: acebott uses esptool bundled, NOT arduino-cli upload |
| 2 | Section 1: arduino-cli installation (already installed via brew) | Reduce to 1-line reference |
| 3 | Ports use `/dev/ttyUSB0` (Linux), project uses macOS | Change to `/dev/cu.usbserial-*` |
| 4 | Windows installation section (project is macOS only) | Remove |
| 5 | FQBN table doesn't mark which is QD001 | Add `← QD001` marker |
| 6 | No reference to ACB_SmartCar_V2 library | Add to common libs list |
| 7 | Inconsistent accents (mixed Spanish with/without accents) | Normalize to Spanish with accents |

### embedded-systems-engineering (4 findings)

| # | Finding | Fix |
|---|---------|-----|
| 1 | Line 32: `调试` (Chinese characters) where should say "debugging" | Replace with "debugging" |
| 2 | Ecosystem table: 7 skills, 4 irrelevant (Cortex-M, Zephyr, RPi) | Reduce to 3 relevant entries |
| 3 | Snyk Code/SAST commercial reference (not actionable) | Remove |
| 4 | Long intro/context before actionable content | Trim |

## Rollback Plan

`git revert <commit>` — single commit, no structural changes.
