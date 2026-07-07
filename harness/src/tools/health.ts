/**
 * robot_health tool — flashes self-test firmware and returns health report.
 *
 * Steps:
 * 1. Detect robot (calls detect logic)
 * 2. If ACECode running → ctx.ui.confirm to kill
 * 3. Compile + flash health_check.ino (guardrailed, 115200 baud)
 * 4. Read serial output
 * 5. Parse JSON lines into HealthReport
 */

import { exec } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { compileSketch } from "../lib/arduino-cli.js";
import { SERIAL_TIMEOUT_MS } from "../lib/constants.js";
import { flashSketch } from "../lib/esptool.js";
import { type HealthReport, isHealthLine, parseHealthLines } from "../lib/parser.js";
import { readSerial } from "../lib/serial.js";
import { detectRobot } from "./detect.js";

const execAsync = promisify(exec);

const FIRMWARE_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"firmware",
	"health_check",
);
const SKETCH_NAME = "health_check";

export interface HealthToolResult {
	report: HealthReport;
	detect: Awaited<ReturnType<typeof detectRobot>>;
	flashed: boolean;
}

/**
 * Core health check logic — callable from integration tests.
 */
export async function runHealthCheck(
	skipFlash: boolean,
	ctx?: ExtensionContext,
): Promise<HealthToolResult> {
	// Step 1: Detect
	const detect = await detectRobot();

	if (!detect.connected || !detect.port) {
		throw new Error("No robot detected. Connect the Acebott QD001 first.");
	}

	// Step 2: ACECode guardrail
	if (detect.acecodeRunning) {
		if (ctx?.hasUI) {
			const ok = await ctx.ui.confirm(
				"ACECode is running and may hold the serial port.",
				"Kill ACECode and proceed with health check?",
			);
			if (!ok) {
				throw new Error("Flash aborted: ACECode is running and user declined to kill it.");
			}
			await execAsync("pkill -9 -f ACECode").catch(() => {});
		} else {
			throw new Error("ACECode is running. Kill it first: pkill -9 -f ACECode");
		}
	}

	let flashed = false;

	// Step 3: Compile + flash (unless skipFlash)
	if (!skipFlash) {
		const buildPath = await mkdtemp(join(tmpdir(), "acebott-build-"));

		const compileResult = await compileSketch({
			sketchPath: FIRMWARE_DIR,
			buildPath,
		});

		if (!compileResult.success) {
			throw new Error(`Compile failed:\n${compileResult.stderr}`);
		}

		const flashResult = await flashSketch({
			buildPath,
			sketchName: SKETCH_NAME,
			port: detect.port,
		});

		if (!flashResult.success) {
			throw new Error(`Flash failed:\n${flashResult.stderr}`);
		}

		flashed = true;
	}

	// Step 4: Read serial output
	const lines = await readSerial({
		port: detect.port,
		baud: 115200,
		timeoutMs: SERIAL_TIMEOUT_MS,
		linePredicate: (line) => line.trim().startsWith("{"),
		stopPredicate: (line) => isHealthLine(line),
	});

	// Step 5: Parse
	const report = parseHealthLines(lines);

	return { report, detect, flashed };
}

/**
 * Register the robot_health tool.
 */
export function registerHealthTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "robot_health",
		label: "Robot Health Check",
		description: `Run a full hardware self-test on the Acebott QD001.

Flashes the health_check.ino firmware and reads serial output to test:
- LEDs (blink test)
- Buzzer (beep test)
- Motors (Init-only, does NOT move the robot)
- Ultrasonic sensor (distance reading)
- Tracking sensors (analog values)
- IR receiver (code detection)

Returns a structured health report with pass/fail for each component.

## When to Use
- After assembly to verify all components work
- Before development to confirm the board is healthy
- When debugging unexpected behavior

## Guardrails
- Blocks if ACECode is running (offers to kill interactively)
- Always flashes at 115200 baud
- Motors test does NOT move the robot (init-only safety)`,
		promptGuidelines: [
			"Use robot_health to run a full hardware self-test before development sessions or when debugging unexpected behavior.",
		],
		parameters: Type.Object({
			skipFlash: Type.Optional(
				Type.Boolean({
					description:
						"Skip compile+flash, only read serial. Use if health_check.ino is already flashed.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Cancelled" }],
					details: { cancelled: true },
				};
			}

			try {
				const skipFlash = params.skipFlash ?? false;

				onUpdate?.({
					content: [
						{
							type: "text",
							text: skipFlash ? "Reading serial..." : "Starting health check...",
						},
					],
					details: {},
				});

				const result = await runHealthCheck(skipFlash, ctx);
				const { report, detect, flashed } = result;

				const summary = [
					`Health Check: ${report.result.toUpperCase()}`,
					`Port: ${detect.port} | Flashed: ${flashed ? "yes" : "no (skipFlash)"}`,
					`LEDs: left=${report.leds.left}, right=${report.leds.right}`,
					`Buzzer: ${report.buzzer}`,
					`Motors (${report.motors.tested}): fl=${report.motors.fl}, fr=${report.motors.fr}, bl=${report.motors.bl}, br=${report.motors.br}`,
					report.ultrasonic.distance_cm !== null
						? `Ultrasonic: ${report.ultrasonic.distance_cm} cm`
						: "Ultrasonic: no data",
					report.tracking.left !== null
						? `Tracking: L=${report.tracking.left}, M=${report.tracking.middle}, R=${report.tracking.right}`
						: "Tracking: no data",
					`IR: ${report.ir.code}`,
				].join("\n");

				return {
					content: [{ type: "text", text: summary }],
					details: { report, port: detect.port, flashed } as unknown as Record<string, unknown>,
				};
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Error: ${msg}` }],
					details: { error: msg } as unknown as Record<string, unknown>,
				};
			}
		},
	});
}
