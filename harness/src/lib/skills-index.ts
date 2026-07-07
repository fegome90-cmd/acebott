/**
 * skills-index — Queryable skill index for Acebott QD001.
 *
 * Provides types, mapping tables, a hand-rolled frontmatter parser,
 * and filesystem helpers for scanning, looking up, and recommending
 * skills from the repo-root `skills/` directory.
 *
 * ADR-001: Hand-rolled parser (no YAML dep)
 * ADR-002: Explicit two-table area mapping
 * ADR-006: Parse-tolerant, FS-honest error handling
 * ADR-007: executeSkillsAction is the single FS authority (this module
 *           provides helpers; flashEntry is called only by tools/skills.ts)
 * ADR-008: Read-only — no writes, no subprocesses, no hardware access
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All recognized skill areas (no "other" — unmapped = []). */
export type RecommendArea =
	| "motors"
	| "sensors"
	| "servo"
	| "ir"
	| "leds"
	| "buzzer"
	| "app"
	| "embedded"
	| "esp32"
	| "flash"
	| "web";

/**
 * Local areas only — excludes "flash" (handled separately by
 * executeSkillsAction via flashEntry). Prevents accidental flash calls
 * at the type level (ADR-007).
 */
export type LocalRecommendArea = Exclude<RecommendArea, "flash">;

/** A single skill entry in the index. */
export interface SkillEntry {
	name: string;
	path: string;
	description: string;
	areas: readonly RecommendArea[];
	hasFrontmatter: boolean;
	/** Raw block between the --- delimiters. Populated only by get. */
	frontmatter?: string;
	/** Full markdown body after the frontmatter block. Populated only by get. */
	body?: string;
}

/** Unified parsed document — ONE parsing algorithm for both FM and body. */
export interface ParsedSkillDocument {
	name: string;
	description: string;
	hasFrontmatter: boolean;
	frontmatter: string;
	body: string;
}

// ---------------------------------------------------------------------------
// Mapping tables (ADR-002)
// ---------------------------------------------------------------------------

/**
 * Requested area → skill name. Aliases are first-class:
 * "leds"/"buzzer" → qd001-leds-buzzer; "app"/"web" → qd001-app-control.
 */
export const AREA_TO_SKILL: Record<RecommendArea, string> = {
	motors: "qd001-motors-mecanum",
	sensors: "qd001-sensors",
	servo: "qd001-servo-scan",
	ir: "qd001-ir-remote",
	leds: "qd001-leds-buzzer",
	buzzer: "qd001-leds-buzzer",
	app: "qd001-app-control",
	web: "qd001-app-control",
	embedded: "embedded-systems-engineering",
	esp32: "esp32-arduino-development",
	flash: "acebott-esp32-flash",
};

/**
 * Skill name → all areas it serves. EXPLICIT table, never derived by
 * inverting AREA_TO_SKILL (resolves H1).
 */
export const SKILL_TO_AREAS: Record<string, readonly RecommendArea[]> = {
	"qd001-motors-mecanum": ["motors"],
	"qd001-sensors": ["sensors"],
	"qd001-servo-scan": ["servo"],
	"qd001-ir-remote": ["ir"],
	"qd001-leds-buzzer": ["leds", "buzzer"],
	"qd001-app-control": ["app", "web"],
	"embedded-systems-engineering": ["embedded"],
	"esp32-arduino-development": ["esp32"],
};

/** Fixed reason text for each requested area (OQ-1). */
export const REASONS: Record<RecommendArea, string> = {
	motors: "qd001-motors-mecanum covers holonomic movement and the ACB_SmartCar_V2 library.",
	sensors: "qd001-sensors covers the HC-SR04 ultrasonic and IR line-tracking sensors.",
	servo: "qd001-servo-scan covers the pan servo (GPIO25) and obstacle-avoidance sweep.",
	ir: "qd001-ir-remote covers the IR receiver (pin 4) and Acebott remote codes.",
	leds: "qd001-leds-buzzer covers the on-board LEDs and PWM control.",
	buzzer: "qd001-leds-buzzer covers the buzzer, tones, and PWM (shared with leds).",
	app: "qd001-app-control covers the Acebott app protocol and WiFi AP setup.",
	web: "qd001-app-control covers web control (including the iOS Safari rendering bug).",
	embedded: "embedded-systems-engineering covers firmware review, ISR/RTOS, and skill vetting.",
	esp32: "esp32-arduino-development covers the ESP32 + arduino-cli toolchain.",
	flash: "acebott-esp32-flash is the canonical flash workflow (external, user-level skill).",
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Returns the areas a skill serves, or [] if unmapped.
 * Reads only from SKILL_TO_AREAS.
 */
export function areasForName(name: string): readonly RecommendArea[] {
	return SKILL_TO_AREAS[name] ?? [];
}

// ---------------------------------------------------------------------------
// Parser (ADR-001) — NEVER throws on content
// ---------------------------------------------------------------------------

/**
 * Hand-rolled, tolerant frontmatter parser.
 *
 * First-line enforcement: frontmatter exists ONLY if the first logical
 * line is exactly "---". If line 1 is not "---", the entire document
 * is body (hasFrontmatter: false).
 *
 * After a valid opening "---" on line 1, locate the next complete line
 * equal to "---". If no closing "---" is found → hasFrontmatter: false,
 * body = entire raw.
 *
 * Extracts `name:` and `description:` via line-prefix match.
 * Quote stripping: matching `"value"` or `'value'` → strip quotes.
 * Single-line values only; multiline YAML is out of scope (M3).
 */
export function parseSkillDocument(raw: string, fallbackName: string): ParsedSkillDocument {
	const lines = raw.split("\n");

	// First-line enforcement: line 1 must be exactly "---"
	if (lines.length === 0 || lines[0]?.trim() !== "---") {
		return {
			name: fallbackName,
			description: "unknown",
			hasFrontmatter: false,
			frontmatter: "",
			body: raw,
		};
	}

	// Find closing "---" (must be a complete line, not a substring)
	let closingIndex = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === "---") {
			closingIndex = i;
			break;
		}
	}

	// Unterminated frontmatter — no closing ---
	if (closingIndex === -1) {
		return {
			name: fallbackName,
			description: "unknown",
			hasFrontmatter: false,
			frontmatter: "",
			body: raw,
		};
	}

	// Extract the frontmatter block (lines between opening and closing ---)
	const fmLines = lines.slice(1, closingIndex);
	const frontmatter = fmLines.join("\n");

	// Body: everything after the closing ---
	const bodyLines = lines.slice(closingIndex + 1);
	const body = bodyLines.join("\n");

	// Parse name and description from frontmatter lines
	let name = fallbackName;
	let description = "unknown";

	for (const line of fmLines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("name:")) {
			name = extractValue(trimmed.slice(5), fallbackName);
		} else if (trimmed.startsWith("description:")) {
			description = extractValue(trimmed.slice(12), "unknown");
		}
	}

	return {
		name,
		description,
		hasFrontmatter: true,
		frontmatter,
		body,
	};
}

/**
 * Extract a value after the colon, stripping matching quotes.
 */
function extractValue(raw: string, fallback: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return fallback;

	// Quote stripping: matching "value" or 'value'
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}

	return trimmed;
}

// ---------------------------------------------------------------------------
// Node error guard (local, NOT exported)
// ---------------------------------------------------------------------------

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}

// ---------------------------------------------------------------------------
// Filesystem helpers (throw operational FS errors per ADR-006)
// ---------------------------------------------------------------------------

/**
 * Scans a skills directory. Returns SkillEntry[] sorted by name.
 *
 * - Skips non-directory entries (e.g. README.md)
 * - Skips subdirectories without SKILL.md
 * - Per-file ENOENT (SKILL.md disappears): skip that entry
 * - Root readdir ENOENT / EACCES: propagate
 * - Empty dir → [] (not an error)
 * - Does NOT populate frontmatter/body (get-only fields)
 */
export async function scanSkills(skillsDir: string): Promise<SkillEntry[]> {
	const entries = await fs.promises.readdir(skillsDir, {
		withFileTypes: true,
	});

	const results: SkillEntry[] = [];

	for (const entry of entries) {
		// Skip non-directory entries
		if (!entry.isDirectory()) continue;

		const skillPath = path.join(skillsDir, entry.name, "SKILL.md");

		let raw: string;
		try {
			raw = await fs.promises.readFile(skillPath, "utf-8");
		} catch (error) {
			// Per-entry ENOENT: skip (SKILL.md disappeared between readdir and readFile)
			if (isNodeError(error) && error.code === "ENOENT") continue;
			// Other errors propagate
			throw error;
		}

		const doc = parseSkillDocument(raw, entry.name);

		results.push({
			name: doc.name,
			path: path.join(skillsDir, entry.name),
			description: doc.description,
			areas: areasForName(doc.name),
			hasFrontmatter: doc.hasFrontmatter,
			// frontmatter/body intentionally omitted — get-only fields
		});
	}

	// Sort by name, secondary sort by path for full determinism
	results.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));

	return results;
}

/**
 * Reads ONE skill by parsed name. Enumerates subdirectories, parses
 * each SKILL.md, matches by parsed `name` field (not dir name).
 *
 * Returns entry WITH populated frontmatter and body.
 * Per-entry ENOENT: skip and continue. Root ENOENT: propagate.
 * Returns null if no match.
 */
export async function getSkillByName(
	skillsDir: string,
	requestedName: string,
): Promise<SkillEntry | null> {
	const entries = await fs.promises.readdir(skillsDir, {
		withFileTypes: true,
	});

	// Collect directories, sort alphabetically for deterministic duplicate handling
	const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

	for (const dir of dirs) {
		const skillPath = path.join(skillsDir, dir.name, "SKILL.md");

		let raw: string;
		try {
			raw = await fs.promises.readFile(skillPath, "utf-8");
		} catch (error) {
			// Per-entry ENOENT: skip and continue
			if (isNodeError(error) && error.code === "ENOENT") continue;
			// Other errors propagate
			throw error;
		}

		const doc = parseSkillDocument(raw, dir.name);

		if (doc.name === requestedName) {
			return {
				name: doc.name,
				path: path.join(skillsDir, dir.name),
				description: doc.description,
				areas: areasForName(doc.name),
				hasFrontmatter: doc.hasFrontmatter,
				frontmatter: doc.frontmatter,
				body: doc.body,
			};
		}
	}

	return null;
}

/**
 * Pure: given scanned entries and a requested area, returns the matching
 * entry + reason, or { entry: null, reason }.
 *
 * Does NOT handle flash (ADR-007) — uses AREA_TO_SKILL for deterministic
 * lookup. Does NOT touch the filesystem.
 */
export function recommendForArea(
	entries: readonly SkillEntry[],
	area: LocalRecommendArea,
): { entry: SkillEntry | null; reason: string } {
	const targetSkill = AREA_TO_SKILL[area];
	const reason = REASONS[area];

	const entry = entries.find((e) => e.name === targetSkill) ?? null;

	return { entry, reason };
}

/**
 * Resolves the external flash skill at
 * ~/.pi/agent/skills/acebott-esp32-flash/SKILL.md.
 *
 * Try-read (no existsSync — avoids TOCTOU):
 * - ENOENT → null (file missing, caller maps to user-friendly text)
 * - EACCES/EIO → propagate (caller maps to error text)
 */
export async function flashEntry(): Promise<SkillEntry | null> {
	const p = path.join(os.homedir(), ".pi/agent/skills/acebott-esp32-flash/SKILL.md");

	let raw: string;
	try {
		raw = await fs.promises.readFile(p, "utf-8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return null;
		throw error; // EACCES, EIO — propagate to executeSkillsAction
	}

	const doc = parseSkillDocument(raw, "acebott-esp32-flash");

	return {
		name: doc.name,
		path: p,
		description: doc.description,
		areas: ["flash"],
		hasFrontmatter: doc.hasFrontmatter,
		frontmatter: doc.frontmatter,
		body: doc.body,
	};
}
