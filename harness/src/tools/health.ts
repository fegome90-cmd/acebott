/**
 * robot_health tool — flashes self-test firmware and returns health report.
 *
 * Lifecycle contract (design AD9, AD10, AD12, AD13, REQ-006, REQ-007):
 * - `runHealthCheck` accepts a `RunHealthCheckOptions` object.
 * - Returns a discriminated `HealthCheckResult`.
 * - Wraps detection, mkdtemp, compile, flash, serial read, and cleanup in
 *   ONE try/catch/finally boundary.
 * - `ChildTerminationError` has PRIORITY over ordinary cancellation.
 * - Failed termination → status "error" + code "child_termination_unconfirmed"
 *   + processMayStillBeRunning + build dir preserved + cleanup skipped.
 * - Cleanup failure MUST NOT change the primary result.
 * - `mapSerialResult` is exhaustive; unknown statuses hit `assertNever`.
 * - `protocol_complete` is a NEUTRAL stage label meaning only "the serial
 *   protocol reached its expected completion marker" — NOT a health verdict.
 */

import { exec } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { compileSketch } from "../lib/arduino-cli.js";
import { ChildTerminationError, safeLog } from "../lib/child-process.js";
import { SERIAL_TIMEOUT_MS } from "../lib/constants.js";
import { flashSketch } from "../lib/esptool.js";
import { type HealthReport, isHealthLine, parseHealthLines } from "../lib/parser.js";
import { readSerial, type SerialReadResult } from "../lib/serial.js";
import type { DetectResult } from "./detect.js";
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

/**
 * Orchestration stage within `runHealthCheck` (design AD9, REQ-006).
 *
 * Transitions: detect → compile → flash → serial → complete.
 * Only `protocol_complete` receives `stage: "complete"` (AD12).
 */
export type HealthStage = "detect" | "compile" | "flash" | "serial" | "complete";

/**
 * Context shared by every `HealthCheckResult` variant (design AD9).
 */
export interface HealthCheckContext {
	stage: HealthStage;
	detect?: DetectResult;
	flashed: boolean;
}

/**
 * Options for `runHealthCheck` (design AD9, REQ-006).
 *
 * Breaking change: replaces positional `(skipFlash, ctx?)` arguments.
 *
 * `log` is an optional diagnostic sink used by safe cleanup. Cleanup/logging
 * failures MUST NOT change the primary result (design AD14).
 */
export interface RunHealthCheckOptions {
	skipFlash: boolean;
	signal?: AbortSignal;
	ctx?: ExtensionContext;
	/** Optional diagnostic sink. Defaults to `console.error` via `safeLog`. */
	log?: (message: string) => void;
}

/**
 * Discriminated health-check result (design AD9, REQ-006, REQ-007).
 *
 * `protocol_complete` means ONLY that the serial protocol reached its
 * expected completion marker — it is NOT a health verdict (REQ-011).
 * It MUST NOT be rendered as "healthy"/"passed"/"all components working".
 */
export type HealthCheckResult =
	| (HealthCheckContext & {
			status: "protocol_complete";
			report: HealthReport;
	  })
	| (HealthCheckContext & {
			status: "incomplete";
			partialData: string[];
			exitCode: 0;
	  })
	| (HealthCheckContext & {
			status: "timeout";
			partialData: string[];
	  })
	| (HealthCheckContext & {
			status: "error";
			error: string;
			code?: "child_termination_unconfirmed" | "operation_failed";
			processMayStillBeRunning?: boolean;
			cleanupSkipped?: boolean;
			artifactsPreservedAt?: string;
			stderr?: string;
			exitCode?: number | null;
			signal?: NodeJS.Signals | null;
			partialData: string[];
	  })
	| (HealthCheckContext & {
			status: "cancelled";
			partialData: string[];
	  });

/**
 * @deprecated Kept for backward compatibility with old callers. New code
 * MUST use `HealthCheckResult` directly. Will be removed in a follow-up.
 */
export interface HealthToolResult {
	report: HealthReport;
	detect: Awaited<ReturnType<typeof detectRobot>>;
	flashed: boolean;
}

/**
 * Exhaustively map every `SerialReadResult` variant to a `HealthCheckResult`
 * (design AD13). Unknown statuses hit `assertNever`.
 *
 * On `success` the stage is promoted to `"complete"`; all other variants
 * keep the caller-supplied stage (typically `"serial"`).
 */
export function mapSerialResult(
	result: SerialReadResult,
	context: HealthCheckContext,
): HealthCheckResult {
	switch (result.status) {
		case "success":
			return {
				status: "protocol_complete",
				report: parseHealthLines(result.data),
				...context,
				stage: "complete",
			};

		case "incomplete":
			return {
				status: "incomplete",
				partialData: result.data,
				exitCode: 0,
				...context,
			};

		case "timeout":
			return {
				status: "timeout",
				partialData: result.data,
				...context,
			};

		case "error":
			return {
				status: "error",
				error: result.error,
				// Map serial "process_failed" to health-context "operation_failed".
				// "child_termination_unconfirmed" passes through unchanged (AD6).
				code:
					result.code === "child_termination_unconfirmed"
						? "child_termination_unconfirmed"
						: "operation_failed",
				processMayStillBeRunning: result.processMayStillBeRunning,
				stderr: result.stderr,
				exitCode: result.exitCode,
				signal: result.signal,
				partialData: result.data,
				...context,
			};

		case "cancelled":
			return {
				status: "cancelled",
				partialData: result.data,
				...context,
			};

		default:
			return assertNever(result);
	}
}

/**
 * Compile-time exhaustiveness check. Throws at runtime if a discriminant
 * is added without updating the switch.
 */
function assertNever(value: never): never {
	throw new Error(`Unreachable: unhandled serial result status: ${JSON.stringify(value)}`);
}

/**
 * True if the error is an `AbortError` (DOMException or Error with name
 * "AbortError"). Used to discriminate cancellation from operation failure.
 */
function isAbortError(error: unknown): boolean {
	if (error instanceof Error) {
		return error.name === "AbortError";
	}
	return false;
}

/**
 * Format any thrown value into a human-readable string.
 */
function formatError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/**
 * Extract a stderr string from an error if one is attached.
 */
function extractStderr(error: unknown): string | undefined {
	if (error instanceof Error) {
		const maybe = (error as { stderr?: unknown }).stderr;
		if (typeof maybe === "string") return maybe;
	}
	return undefined;
}

/**
 * Extract an exit code from an error if one is attached.
 */
function extractExitCode(error: unknown): number | null | undefined {
	if (error instanceof Error && "exitCode" in error) {
		const code = (error as { exitCode: unknown }).exitCode;
		if (typeof code === "number" || code === null) return code;
	}
	return undefined;
}

/**
 * Extract a signal code from an error if one is attached.
 */
function extractSignalCode(error: unknown): NodeJS.Signals | null | undefined {
	if (error instanceof Error && "signalCode" in error) {
		const code = (error as { signalCode: unknown }).signalCode;
		if (code === null || typeof code === "string") return code as NodeJS.Signals | null;
	}
	return undefined;
}

/**
 * Throw an AbortError if the signal is already aborted. Used as a checkpoint
 * between async operations.
 */
function assertNotAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		const err = new Error("The operation was aborted");
		err.name = "AbortError";
		throw err;
	}
}

/**
 * Remove a build directory, swallowing any error and logging through the
 * optional sink. Cleanup failure MUST NOT change the primary operation
 * result (design AD14).
 */
async function safeRemoveBuildDir(
	directory: string,
	log: ((message: string) => void) | undefined,
): Promise<void> {
	try {
		await rm(directory, { recursive: true, force: true });
	} catch (error) {
		safeLog(log, `Failed to remove build directory ${directory}: ${formatError(error)}`);
	}
}

/**
 * Core health check logic — callable from integration tests.
 *
 * Wraps detection, mkdtemp, compile, flash, serial read, and cleanup in ONE
 * try/catch/finally boundary. `ChildTerminationError` has PRIORITY over
 * ordinary cancellation (design AD6, REQ-007).
 *
 * Breaking change: signature is now `(options: RunHealthCheckOptions)`.
 */
export async function runHealthCheck(options: RunHealthCheckOptions): Promise<HealthCheckResult> {
	let stage: HealthStage = "detect";
	let detect: DetectResult | undefined;
	let flashed = false;
	let buildDir: string | undefined;
	let cleanupAllowed = true;

	try {
		assertNotAborted(options.signal);

		// Detection may throw; the catch block maps it to stage "detect".
		const detectResult = await detectRobot();
		detect = detectResult;

		if (!detectResult.connected || !detectResult.port) {
			return {
				status: "error",
				error: "No robot detected. Connect the Acebott QD001 first.",
				code: "operation_failed",
				partialData: [],
				stage,
				detect,
				flashed,
			};
		}

		// ACECode guardrail — only prompt if we have a UI.
		if (detectResult.acecodeRunning) {
			if (options.ctx?.hasUI) {
				const ok = await options.ctx.ui.confirm(
					"ACECode is running and may hold the serial port.",
					"Kill ACECode and proceed with health check?",
				);
				if (!ok) {
					return {
						status: "error",
						error: "Flash aborted: ACECode is running and user declined to kill it.",
						code: "operation_failed",
						partialData: [],
						stage,
						detect,
						flashed,
					};
				}
				try {
					await execAsync("pkill -9 -f ACECode");
				} catch (error) {
					// pkill failure is non-fatal — proceed with health check — but
					// log so the user can correlate a later serial failure with a
					// failed kill. Common cases: ACECode already exited (non-zero
					// exit), pkill not installed (ENOENT), permission denied.
					safeLog(
						options.log,
						`pkill ACECode failed: ${formatError(error)}. Serial port may still be busy.`,
					);
				}
			} else {
				return {
					status: "error",
					error: "ACECode is running. Kill it first: pkill -9 -f ACECode",
					code: "operation_failed",
					partialData: [],
					stage,
					detect,
					flashed,
				};
			}
		}

		// Re-check abort after detection and ACECode handling.
		assertNotAborted(options.signal);

		if (!options.skipFlash) {
			stage = "compile";
			buildDir = await mkdtemp(join(tmpdir(), "acebott-build-"));

			const compileResult = await compileSketch({
				sketchPath: FIRMWARE_DIR,
				buildPath: buildDir,
				signal: options.signal,
			});

			if (!compileResult.success) {
				return {
					status: "error",
					error: `Compile failed:\n${compileResult.stderr}`,
					code: "operation_failed",
					stderr: compileResult.stderr,
					partialData: [],
					stage,
					detect,
					flashed,
				};
			}

			assertNotAborted(options.signal);

			stage = "flash";
			const flashResult = await flashSketch({
				buildPath: buildDir,
				sketchName: SKETCH_NAME,
				port: detectResult.port,
				signal: options.signal,
			});

			if (!flashResult.success) {
				return {
					status: "error",
					error: `Flash failed:\n${flashResult.stderr}`,
					code: "operation_failed",
					stderr: flashResult.stderr,
					partialData: [],
					stage,
					detect,
					flashed,
				};
			}

			flashed = true;
			assertNotAborted(options.signal);
		}

		stage = "serial";

		const serialResult = await readSerial({
			port: detectResult.port,
			baud: 115200,
			timeoutMs: SERIAL_TIMEOUT_MS,
			signal: options.signal,
			linePredicate: (line) => line.trim().startsWith("{"),
			stopPredicate: (line) => isHealthLine(line),
		});

		return mapSerialResult(serialResult, { stage: "serial", detect, flashed });
	} catch (error) {
		// ChildTerminationError has PRIORITY over ordinary cancellation.
		// The process may still be running; cleanup is forbidden (AD6).
		if (error instanceof ChildTerminationError) {
			cleanupAllowed = false;
			return {
				status: "error",
				code: "child_termination_unconfirmed",
				error: error.message,
				processMayStillBeRunning: true,
				cleanupSkipped: buildDir !== undefined,
				artifactsPreservedAt: buildDir,
				partialData: [],
				stage,
				detect,
				flashed,
			};
		}

		// Ordinary abort → cancelled.
		if (options.signal?.aborted || isAbortError(error)) {
			return {
				status: "cancelled",
				partialData: [],
				stage,
				detect,
				flashed,
			};
		}

		// Any other failure → operation error (preserves stderr/exitCode/signal
		// metadata if attached to the thrown error).
		return {
			status: "error",
			code: "operation_failed",
			error: formatError(error),
			stderr: extractStderr(error),
			exitCode: extractExitCode(error),
			signal: extractSignalCode(error),
			partialData: [],
			stage,
			detect,
			flashed,
		};
	} finally {
		if (buildDir !== undefined) {
			if (cleanupAllowed) {
				await safeRemoveBuildDir(buildDir, options.log);
			} else {
				safeLog(
					options.log,
					`Build directory preserved because child-process termination was not confirmed: ${buildDir}`,
				);
			}
		}
	}
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

				const result = await runHealthCheck({ skipFlash, signal, ctx });

				// Render every result variant using diagnostically neutral language.
				// `protocol_complete` is NOT a health verdict (REQ-011).
				return renderHealthResult(result);
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

/**
 * Render a `HealthCheckResult` for the tool caller.
 *
 * Stays diagnostically neutral: `protocol_complete` is rendered as
 * "Protocol complete" — never "healthy" or "passed" (REQ-011).
 */
function renderHealthResult(result: HealthCheckResult): {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
} {
	const baseDetails: Record<string, unknown> = {
		stage: result.stage,
		flashed: result.flashed,
		detect: result.detect,
	};

	switch (result.status) {
		case "protocol_complete": {
			const report = result.report;
			const summary = [
				"Protocol complete",
				`Port: ${result.detect?.port ?? "unknown"} | Flashed: ${result.flashed ? "yes" : "no (skipFlash)"}`,
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
				details: { ...baseDetails, report },
			};
		}

		case "incomplete":
			return {
				content: [
					{
						type: "text",
						text: `Protocol incomplete (process exited with code ${result.exitCode} before completion marker). ${result.partialData.length} line(s) captured.`,
					},
				],
				details: { ...baseDetails, partialData: result.partialData, exitCode: result.exitCode },
			};

		case "timeout":
			return {
				content: [
					{
						type: "text",
						text: `Serial read timed out. ${result.partialData.length} line(s) captured.`,
					},
				],
				details: { ...baseDetails, partialData: result.partialData },
			};

		case "error": {
			const detail: Record<string, unknown> = {
				...baseDetails,
				error: result.error,
				partialData: result.partialData,
			};
			if (result.code) detail.code = result.code;
			if (result.processMayStillBeRunning) detail.processMayStillBeRunning = true;
			if (result.cleanupSkipped) detail.cleanupSkipped = true;
			if (result.artifactsPreservedAt) detail.artifactsPreservedAt = result.artifactsPreservedAt;
			if (result.stderr) detail.stderr = result.stderr;
			if (result.exitCode !== undefined) detail.exitCode = result.exitCode;
			if (result.signal !== undefined) detail.signal = result.signal;
			const text =
				result.code === "child_termination_unconfirmed"
					? `Error: ${result.error}\nWARNING: child-process termination was not confirmed — process may still be running. Build artifacts preserved at: ${result.artifactsPreservedAt ?? "(unknown)"}`
					: `Error: ${result.error}`;
			return {
				content: [{ type: "text", text }],
				details: detail,
			};
		}

		case "cancelled":
			return {
				content: [{ type: "text", text: "Cancelled" }],
				details: { ...baseDetails, partialData: result.partialData, cancelled: true },
			};

		default:
			return assertNever(result);
	}
}
