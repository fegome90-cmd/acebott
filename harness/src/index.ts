/**
 * @acebott/harness — Pi domain harness for Acebott QD001.
 *
 * Registers native tools that give the agent hardware expertise:
 * - robot_detect: detect connected robot, port, chip, ACECode state
 * - robot_health: flash self-test firmware and return health report
 *
 * Install via symlink:
 *   ln -s ~/Developer/acebott/harness ~/.pi/agent/extensions/acebott-harness
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDetectTool } from "./tools/detect.js";
import { registerHealthTool } from "./tools/health.js";
import { registerSkillsTool } from "./tools/skills.js";

export default function (pi: ExtensionAPI) {
	// Register tools
	registerDetectTool(pi);
	registerHealthTool(pi);
	registerSkillsTool(pi);

	// No timers or background state to clean up.
	// session_shutdown hook not needed — all operations are synchronous
	// tool calls that complete before shutdown.
}

export { type CompileResult, compileSketch } from "./lib/arduino-cli.js";
export * from "./lib/constants.js";
export {
	checkEsptoolAvailable,
	type FlashResult,
	flashSketch,
} from "./lib/esptool.js";
export {
	createDefaultReport,
	type HealthReport,
	isHealthLine,
	parseHealthLines,
} from "./lib/parser.js";
export { readSerial, type SerialReadOptions } from "./lib/serial.js";
export {
	getSkillByName,
	type RecommendArea,
	type SkillEntry,
	scanSkills,
} from "./lib/skills-index.js";
export { type ChipInfo, detectChip } from "./lib/usb.js";
// Re-export types and utilities for testing
export { type DetectResult, detectRobot } from "./tools/detect.js";
export { type HealthToolResult, runHealthCheck } from "./tools/health.js";
export {
	executeSkillsAction,
	type SkillsResult,
	type SkillsToolResponse,
} from "./tools/skills.js";
