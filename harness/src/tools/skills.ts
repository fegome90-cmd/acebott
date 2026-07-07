/**
 * robot_skills tool — discover and fetch domain skills for Acebott QD001.
 *
 * Exposes the repo-root `skills/` directory as a queryable index with
 * 3 actions: recommend, list, get.
 *
 * ADR-007: executeSkillsAction is the SINGLE filesystem authority.
 * ADR-008: Read-only — no writes, no subprocesses, no hardware access.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { RecommendArea, SkillEntry } from "../lib/skills-index.js";
import { flashEntry, getSkillByName, recommendForArea, scanSkills } from "../lib/skills-index.js";

// ---------------------------------------------------------------------------
// StringEnum — typebox 0.34 has no built-in StringEnum
// Uses <const T extends readonly string[]> + [...values] to preserve
// literal union inference.
// ---------------------------------------------------------------------------

const StringEnum = <const T extends readonly string[]>(values: T) =>
	Type.Unsafe<T[number]>({ type: "string", enum: [...values] });

// ---------------------------------------------------------------------------
// Response types (exported for test contract alignment)
// ---------------------------------------------------------------------------

export interface SkillsResult {
	skills: SkillEntry[];
	recommended?: { name: string; path: string; reason: string };
}

export interface SkillsToolResponse {
	content: Array<{ type: "text"; text: string }>;
	details: SkillsResult;
}

// ---------------------------------------------------------------------------
// Flash helper — resolves external skill, maps errors to text
// ---------------------------------------------------------------------------

const FLASH_NOT_INSTALLED = "External flash skill not installed: acebott-esp32-flash";
const FLASH_REASON =
	"acebott-esp32-flash is the canonical flash workflow (external, user-level skill).";

async function handleFlashRecommend(): Promise<SkillsToolResponse> {
	const flash = await flashEntry();
	if (!flash) {
		return { content: [{ type: "text", text: FLASH_NOT_INSTALLED }], details: { skills: [] } };
	}
	return {
		content: [{ type: "text", text: `Recommended: ${flash.name} — ${FLASH_REASON}` }],
		details: {
			skills: [stripGetOnly(flash)],
			recommended: { name: flash.name, path: flash.path, reason: FLASH_REASON },
		},
	};
}

async function handleFlashGet(): Promise<SkillsToolResponse> {
	const flash = await flashEntry();
	if (!flash) {
		return { content: [{ type: "text", text: FLASH_NOT_INSTALLED }], details: { skills: [] } };
	}
	return {
		content: [{ type: "text", text: `Skill: ${flash.name}\n\n${flash.body ?? ""}` }],
		details: { skills: [flash] },
	};
}

// ---------------------------------------------------------------------------
// Strip frontmatter/body from an entry (get-only fields)
// ---------------------------------------------------------------------------

function stripGetOnly(entry: SkillEntry): SkillEntry {
	const { frontmatter: _fm, body: _body, ...meta } = entry;
	return meta;
}

// ---------------------------------------------------------------------------
// Error mapping — the tool NEVER throws (ADR-006)
// ---------------------------------------------------------------------------

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}

function mapError(err: unknown, isFlashPath: boolean): SkillsToolResponse {
	if (isFlashPath && isNodeError(err) && err.code === "EACCES") {
		return {
			content: [{ type: "text", text: "Permission denied while reading external flash skill" }],
			details: { skills: [] },
		};
	}
	if (isNodeError(err)) {
		if (err.code === "ENOENT") {
			return {
				content: [{ type: "text", text: "skills directory not found" }],
				details: { skills: [] },
			};
		}
		if (err.code === "EACCES") {
			return { content: [{ type: "text", text: "Permission denied" }], details: { skills: [] } };
		}
	}
	const msg = err instanceof Error ? err.message : String(err);
	return { content: [{ type: "text", text: `Error: ${msg}` }], details: { skills: [] } };
}

// ---------------------------------------------------------------------------
// executeSkillsAction — the single FS authority (ADR-007)
// ---------------------------------------------------------------------------

export async function executeSkillsAction(params: {
	action: "recommend" | "list" | "get";
	area?: RecommendArea;
	name?: string;
	cwd: string;
}): Promise<SkillsToolResponse> {
	const { action, area, name, cwd } = params;
	const isFlashPath = name === "acebott-esp32-flash" || area === "flash";

	try {
		switch (action) {
			case "list": {
				const skillsDir = `${cwd}/skills`;
				const entries = await scanSkills(skillsDir);
				if (entries.length === 0) {
					return {
						content: [{ type: "text", text: `No skills found in ${skillsDir}` }],
						details: { skills: [] },
					};
				}
				return {
					content: [{ type: "text", text: `Found ${entries.length} skill(s) in ${skillsDir}` }],
					details: { skills: entries.map(stripGetOnly) },
				};
			}
			case "recommend": {
				if (!area) {
					return {
						content: [{ type: "text", text: "area is required for recommend action" }],
						details: { skills: [] },
					};
				}
				if (area === "flash") return handleFlashRecommend();
				return await handleLocalRecommend(cwd, area);
			}
			case "get": {
				if (!name) {
					return {
						content: [{ type: "text", text: "name is required for get action" }],
						details: { skills: [] },
					};
				}
				if (name === "acebott-esp32-flash") return handleFlashGet();
				return await handleLocalGet(cwd, name);
			}
		}
	} catch (err: unknown) {
		return mapError(err, isFlashPath);
	}
}

// ---------------------------------------------------------------------------
// Local action helpers — extracted from switch to reduce complexity
// ---------------------------------------------------------------------------

async function handleLocalRecommend(cwd: string, area: RecommendArea): Promise<SkillsToolResponse> {
	const skillsDir = `${cwd}/skills`;
	const entries = await scanSkills(skillsDir);
	const { entry, reason } = recommendForArea(entries, area as Exclude<RecommendArea, "flash">);
	if (!entry) {
		return {
			content: [{ type: "text", text: `Skill not found for area: ${area}` }],
			details: { skills: [] },
		};
	}
	return {
		content: [{ type: "text", text: `Recommended: ${entry.name} — ${reason}` }],
		details: {
			skills: [stripGetOnly(entry)],
			recommended: { name: entry.name, path: entry.path, reason },
		},
	};
}

async function handleLocalGet(cwd: string, name: string): Promise<SkillsToolResponse> {
	const skillsDir = `${cwd}/skills`;
	const entry = await getSkillByName(skillsDir, name);
	if (!entry) {
		return {
			content: [{ type: "text", text: `Skill not found: ${name}` }],
			details: { skills: [] },
		};
	}
	return {
		content: [{ type: "text", text: `Skill: ${entry.name}\n\n${entry.body ?? ""}` }],
		details: { skills: [entry] },
	};
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerSkillsTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "robot_skills",
		label: "Robot Skills",
		description: `Discover and fetch domain skills for Acebott QD001.

Reads the repo-root skills/ directory and returns structured skill
metadata. The flash skill resolves to an external user-level install.

## Actions
- list: return all skills with names, paths, and area tags
- recommend <area>: return the best skill for a given area
- get <name>: return full SKILL.md content (frontmatter + body)

## Areas
motors, sensors, servo, ir, leds, buzzer, app, embedded, esp32, flash, web`,
		parameters: Type.Object({
			action: StringEnum(["recommend", "list", "get"]),
			area: Type.Optional(
				StringEnum([
					"motors",
					"sensors",
					"servo",
					"ir",
					"leds",
					"buzzer",
					"app",
					"embedded",
					"esp32",
					"flash",
					"web",
				]),
			),
			name: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return executeSkillsAction({
				...params,
				cwd: ctx.cwd,
			} as Parameters<typeof executeSkillsAction>[0]);
		},
	});
}
