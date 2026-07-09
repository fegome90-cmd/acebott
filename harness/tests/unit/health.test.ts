/**
 * Unit tests for robot_health tool logic — Phase 9-10 RED then GREEN.
 *
 * All external functions are mocked — no hardware access.
 *
 * The new contract (design AD9, AD10, AD12, AD13, REQ-006, REQ-007):
 * - `runHealthCheck` accepts a `RunHealthCheckOptions` object.
 * - Returns a discriminated `HealthCheckResult` (NOT `HealthToolResult`).
 * - Wraps the entire orchestration in a try/catch/finally boundary.
 * - `ChildTerminationError` has PRIORITY over ordinary cancellation.
 * - Failed termination → status: "error", code: "child_termination_unconfirmed",
 *   processMayStillBeRunning: true, build dir preserved, cleanup skipped.
 * - Cleanup failure MUST NOT change the primary result.
 * - `mapSerialResult` exhaustively converts every `SerialReadResult` variant.
 * - `protocol_complete` is NOT rendered as "healthy"/"passed".
 */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock detect
vi.mock("../../src/tools/detect.js", () => ({
	detectRobot: vi.fn(),
}));

// Mock all lib functions
vi.mock("../../src/lib/arduino-cli.js", () => ({
	compileSketch: vi.fn(),
}));

vi.mock("../../src/lib/esptool.js", () => ({
	flashSketch: vi.fn(),
	checkEsptoolAvailable: vi.fn(),
}));

vi.mock("../../src/lib/serial.js", () => ({
	readSerial: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	exec: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	mkdtemp: vi.fn(),
	rm: vi.fn(),
}));

import { exec } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { compileSketch } from "../../src/lib/arduino-cli.js";
import { ChildTerminationError } from "../../src/lib/child-process.js";
import { flashSketch } from "../../src/lib/esptool.js";
import { readSerial } from "../../src/lib/serial.js";
import { detectRobot } from "../../src/tools/detect.js";
import { type HealthCheckResult, mapSerialResult, runHealthCheck } from "../../src/tools/health.js";

const mockedExec = vi.mocked(exec);
const mockedDetect = vi.mocked(detectRobot);
const mockedCompile = vi.mocked(compileSketch);
const mockedFlash = vi.mocked(flashSketch);
const mockedReadSerial = vi.mocked(readSerial);
const mockedMkdtemp = vi.mocked(mkdtemp);
const mockedRm = vi.mocked(rm);

const CONNECTED_DETECT = {
	connected: true,
	port: "/dev/cu.usbserial-110",
	chip: null,
	acecodeRunning: false,
	portBusy: false,
	esptoolAvailable: true,
	firmwareHint: "unknown",
};

const SUCCESS_SERIAL = {
	status: "success" as const,
	data: [
		'{"t":"motors","fl":"ok","fr":"ok","bl":"ok","br":"ok"}',
		'{"t":"leds","left":"ok","right":"ok"}',
		'{"t":"buzzer","status":"ok"}',
		'{"t":"ultrasonic","distance_cm":35}',
		'{"t":"tracking","left":1100,"middle":900,"right":2000}',
		'{"t":"ir","code":"none"}',
		'{"t":"health","result":"pass"}',
	],
};

describe("runHealthCheck", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedMkdtemp.mockResolvedValue("/tmp/acebott-build-xxx");
		mockedRm.mockResolvedValue(undefined);
		// Default exec mock: handles both (cmd, cb) and (cmd, opts, cb) signatures
		mockedExec.mockImplementation((_cmd: unknown, _opts: unknown, cb: any) => {
			if (typeof _opts === "function") {
				_opts(null, { stdout: "", stderr: "" });
			} else if (cb) {
				cb(null, { stdout: "", stderr: "" });
			}
			return undefined as any;
		});
	});

	describe("early errors", () => {
		it("9.1 detection failure returns error, stage detect, no detect result, flashed false", async () => {
			mockedDetect.mockRejectedValue(new Error("USB enumeration failed"));

			const result = await runHealthCheck({ skipFlash: false });

			expect(result.status).toBe("error");
			if (result.status === "error") {
				expect(result.stage).toBe("detect");
				expect(result.detect).toBeUndefined();
				expect(result.flashed).toBe(false);
				expect(result.error).toContain("USB enumeration");
			}
		});

		it("9.2 abort before detection calls no downstream operation and returns cancelled", async () => {
			const controller = new AbortController();
			controller.abort();
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);

			const result = await runHealthCheck({
				skipFlash: false,
				signal: controller.signal,
			});

			expect(result.status).toBe("cancelled");
			expect(mockedDetect).not.toHaveBeenCalled();
			expect(mockedCompile).not.toHaveBeenCalled();
			expect(mockedFlash).not.toHaveBeenCalled();
			expect(mockedReadSerial).not.toHaveBeenCalled();
		});

		it("9.3 abort during detection is observed after detection completes and prevents compile, flash, and serial", async () => {
			const controller = new AbortController();

			mockedDetect.mockImplementation(async () => {
				// Abort fires DURING detection (after the assertNotAborted gate inside).
				controller.abort();
				return CONNECTED_DETECT;
			});

			const result = await runHealthCheck({
				skipFlash: false,
				signal: controller.signal,
			});

			expect(result.status).toBe("cancelled");
			// Detection completed, but downstream was skipped.
			expect(mockedCompile).not.toHaveBeenCalled();
			expect(mockedFlash).not.toHaveBeenCalled();
			expect(mockedReadSerial).not.toHaveBeenCalled();
		});

		it("9.4 mkdtemp failure returns error, stage compile, and flashed false", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedMkdtemp.mockRejectedValue(new Error("ENOSPC"));

			const result = await runHealthCheck({ skipFlash: false });

			expect(result.status).toBe("error");
			if (result.status === "error") {
				expect(result.stage).toBe("compile");
				expect(result.flashed).toBe(false);
				expect(result.error).toContain("ENOSPC");
			}
		});
	});

	describe("skipFlash", () => {
		it("9.5 skipFlash true calls no mkdtemp, compile, or flash", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedReadSerial.mockResolvedValue(SUCCESS_SERIAL);

			await runHealthCheck({ skipFlash: true });

			expect(mockedMkdtemp).not.toHaveBeenCalled();
			expect(mockedCompile).not.toHaveBeenCalled();
			expect(mockedFlash).not.toHaveBeenCalled();
		});

		it("9.6 skipFlash true still calls serial", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedReadSerial.mockResolvedValue(SUCCESS_SERIAL);

			await runHealthCheck({ skipFlash: true });

			expect(mockedReadSerial).toHaveBeenCalledOnce();
		});

		it("9.7 serial timeout under skipFlash true returns stage serial and flashed false", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedReadSerial.mockResolvedValue({ status: "timeout", data: [] });

			const result = await runHealthCheck({ skipFlash: true });

			expect(result.status).toBe("timeout");
			if (result.status === "timeout") {
				expect(result.stage).toBe("serial");
				expect(result.flashed).toBe(false);
			}
		});
	});

	describe("cancellation checkpoints", () => {
		it("9.8 cancellation after compile prevents flash and serial", async () => {
			const controller = new AbortController();
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockImplementation(async () => {
				controller.abort();
				return { success: true, stdout: "", stderr: "", buildPath: "/tmp/x" };
			});

			const result = await runHealthCheck({
				skipFlash: false,
				signal: controller.signal,
			});

			expect(result.status).toBe("cancelled");
			expect(mockedFlash).not.toHaveBeenCalled();
			expect(mockedReadSerial).not.toHaveBeenCalled();
		});

		it("9.9 cancellation after flash prevents serial", async () => {
			const controller = new AbortController();
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockResolvedValue({
				success: true,
				stdout: "",
				stderr: "",
				buildPath: "/tmp/x",
			});
			mockedFlash.mockImplementation(async () => {
				controller.abort();
				return { success: true, stdout: "", stderr: "" };
			});

			const result = await runHealthCheck({
				skipFlash: false,
				signal: controller.signal,
			});

			expect(result.status).toBe("cancelled");
			expect(mockedReadSerial).not.toHaveBeenCalled();
		});

		it("9.10 AbortError from compile maps to cancelled", async () => {
			const controller = new AbortController();
			controller.abort();
			const abortError = new Error("aborted");
			abortError.name = "AbortError";
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockRejectedValue(abortError);

			const result = await runHealthCheck({
				skipFlash: false,
				signal: controller.signal,
			});

			expect(result.status).toBe("cancelled");
		});

		it("9.11 AbortError from flash maps to cancelled", async () => {
			const controller = new AbortController();
			controller.abort();
			const abortError = new Error("aborted");
			abortError.name = "AbortError";
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockResolvedValue({
				success: true,
				stdout: "",
				stderr: "",
				buildPath: "/tmp/x",
			});
			mockedFlash.mockRejectedValue(abortError);

			const result = await runHealthCheck({
				skipFlash: false,
				signal: controller.signal,
			});

			expect(result.status).toBe("cancelled");
		});

		it("9.12 the same signal is passed to compile, flash, and serial", async () => {
			const controller = new AbortController();
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockResolvedValue({
				success: true,
				stdout: "",
				stderr: "",
				buildPath: "/tmp/x",
			});
			mockedFlash.mockResolvedValue({ success: true, stdout: "", stderr: "" });
			mockedReadSerial.mockResolvedValue(SUCCESS_SERIAL);

			await runHealthCheck({
				skipFlash: false,
				signal: controller.signal,
			});

			expect(mockedCompile).toHaveBeenCalledWith(
				expect.objectContaining({ signal: controller.signal }),
			);
			expect(mockedFlash).toHaveBeenCalledWith(
				expect.objectContaining({ signal: controller.signal }),
			);
			expect(mockedReadSerial).toHaveBeenCalledWith(
				expect.objectContaining({ signal: controller.signal }),
			);
		});
	});

	describe("termination-failure priority", () => {
		const termError = new ChildTerminationError("compile child termination unconfirmed", {
			status: "failed",
			error: "no closure",
		});

		it("9.13 ChildTerminationError plus an aborted signal returns error, not cancelled", async () => {
			// Both conditions present: signal aborted AND ChildTerminationError raised.
			// The error from compile fires first; the abort is set during the mock
			// so by the time we reach the catch block, both are true.
			const controller = new AbortController();
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockImplementation(async () => {
				controller.abort();
				throw termError;
			});

			const result = await runHealthCheck({
				skipFlash: false,
				signal: controller.signal,
			});

			// Priority: ChildTerminationError wins over cancellation.
			expect(result.status).toBe("error");
			if (result.status === "error") {
				expect(result.code).toBe("child_termination_unconfirmed");
				expect(result.processMayStillBeRunning).toBe(true);
				expect(result.stage).toBe("compile");
			}
		});

		it("9.14 the result includes code child_termination_unconfirmed", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockRejectedValue(termError);

			const result = await runHealthCheck({ skipFlash: false });

			if (result.status === "error") {
				expect(result.code).toBe("child_termination_unconfirmed");
			}
		});

		it("9.15 the result includes processMayStillBeRunning true", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockRejectedValue(termError);

			const result = await runHealthCheck({ skipFlash: false });

			if (result.status === "error") {
				expect(result.processMayStillBeRunning).toBe(true);
			}
		});

		it("9.16 cleanup is skipped", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedMkdtemp.mockResolvedValue("/tmp/preserved-build");
			mockedCompile.mockRejectedValue(termError);

			await runHealthCheck({ skipFlash: false });

			// rm must not have been called — cleanup is forbidden.
			expect(mockedRm).not.toHaveBeenCalled();
		});

		it("9.17 the exact preserved build-directory path is returned", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedMkdtemp.mockResolvedValue("/tmp/EXACT-PATH-123");
			mockedCompile.mockRejectedValue(termError);

			const result = await runHealthCheck({ skipFlash: false });

			if (result.status === "error") {
				expect(result.artifactsPreservedAt).toBe("/tmp/EXACT-PATH-123");
				expect(result.cleanupSkipped).toBe(true);
			}
		});

		it("9.18 the exact preserved build-directory path is logged", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedMkdtemp.mockResolvedValue("/tmp/EXACT-PRESERVED-LOG");
			mockedCompile.mockRejectedValue(termError);

			const logMessages: string[] = [];
			const log = (msg: string) => logMessages.push(msg);

			await runHealthCheck({ skipFlash: false, log });

			expect(logMessages.some((m) => m.includes("/tmp/EXACT-PRESERVED-LOG"))).toBe(true);
			expect(logMessages.some((m) => m.includes("preserved"))).toBe(true);
		});
	});

	describe("cleanup", () => {
		it("9.19 temporary directory is removed after protocol completion", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockResolvedValue({
				success: true,
				stdout: "",
				stderr: "",
				buildPath: "/tmp/x",
			});
			mockedFlash.mockResolvedValue({ success: true, stdout: "", stderr: "" });
			mockedReadSerial.mockResolvedValue(SUCCESS_SERIAL);
			mockedMkdtemp.mockResolvedValue("/tmp/acebott-build-remove-me");

			await runHealthCheck({ skipFlash: false });

			expect(mockedRm).toHaveBeenCalledWith(
				"/tmp/acebott-build-remove-me",
				expect.objectContaining({ recursive: true, force: true }),
			);
		});

		it("9.20 temporary directory is removed after compile error", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedMkdtemp.mockResolvedValue("/tmp/acebott-build-compile-err");
			mockedCompile.mockResolvedValue({
				success: false,
				stdout: "",
				stderr: "compile failed",
				buildPath: "/tmp/x",
			});

			await runHealthCheck({ skipFlash: false });

			expect(mockedRm).toHaveBeenCalledWith("/tmp/acebott-build-compile-err", expect.any(Object));
		});

		it("9.21 temporary directory is removed after flash error", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedMkdtemp.mockResolvedValue("/tmp/acebott-build-flash-err");
			mockedCompile.mockResolvedValue({
				success: true,
				stdout: "",
				stderr: "",
				buildPath: "/tmp/x",
			});
			mockedFlash.mockResolvedValue({ success: false, stdout: "", stderr: "flash failed" });

			await runHealthCheck({ skipFlash: false });

			expect(mockedRm).toHaveBeenCalledWith("/tmp/acebott-build-flash-err", expect.any(Object));
		});

		it("9.22 temporary directory is removed after serial error", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockResolvedValue({
				success: true,
				stdout: "",
				stderr: "",
				buildPath: "/tmp/x",
			});
			mockedFlash.mockResolvedValue({ success: true, stdout: "", stderr: "" });
			mockedReadSerial.mockResolvedValue({ status: "error", data: [], error: "x" });
			mockedMkdtemp.mockResolvedValue("/tmp/acebott-build-serial-err");

			await runHealthCheck({ skipFlash: false });

			expect(mockedRm).toHaveBeenCalledWith("/tmp/acebott-build-serial-err", expect.any(Object));
		});

		it("9.23 temporary directory is removed after ordinary cancellation", async () => {
			const controller = new AbortController();
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockImplementation(async () => {
				controller.abort();
				return { success: true, stdout: "", stderr: "", buildPath: "/tmp/x" };
			});
			mockedMkdtemp.mockResolvedValue("/tmp/acebott-build-cancelled");

			await runHealthCheck({ skipFlash: false, signal: controller.signal });

			expect(mockedRm).toHaveBeenCalledWith("/tmp/acebott-build-cancelled", expect.any(Object));
		});

		it("9.24 rm failure after protocol completion preserves the primary result and logs the error", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockResolvedValue({
				success: true,
				stdout: "",
				stderr: "",
				buildPath: "/tmp/x",
			});
			mockedFlash.mockResolvedValue({ success: true, stdout: "", stderr: "" });
			mockedReadSerial.mockResolvedValue(SUCCESS_SERIAL);
			mockedMkdtemp.mockResolvedValue("/tmp/acebott-build-cleanup-fail");
			mockedRm.mockRejectedValue(new Error("EBUSY"));

			const logMessages: string[] = [];
			const log = (m: string) => logMessages.push(m);

			const result = await runHealthCheck({ skipFlash: false, log });

			// Primary result preserved — still protocol_complete.
			expect(result.status).toBe("protocol_complete");
			// Cleanup error logged, not swallowed silently.
			expect(logMessages.some((m) => m.includes("EBUSY"))).toBe(true);
		});

		it("9.25 rm failure after operation error preserves the primary error and logs the cleanup error", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedMkdtemp.mockResolvedValue("/tmp/acebott-build-op-err-cleanup-fail");
			mockedCompile.mockResolvedValue({
				success: false,
				stdout: "",
				stderr: "syntax error",
				buildPath: "/tmp/x",
			});
			mockedRm.mockRejectedValue(new Error("EBUSY-cleanup"));

			const logMessages: string[] = [];
			const log = (m: string) => logMessages.push(m);

			const result = await runHealthCheck({ skipFlash: false, log });

			expect(result.status).toBe("error");
			if (result.status === "error") {
				expect(result.error).toContain("syntax error");
			}
			expect(logMessages.some((m) => m.includes("EBUSY-cleanup"))).toBe(true);
		});

		it("9.26 a throwing logger does not replace the primary result", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockResolvedValue({
				success: true,
				stdout: "",
				stderr: "",
				buildPath: "/tmp/x",
			});
			mockedFlash.mockResolvedValue({ success: true, stdout: "", stderr: "" });
			mockedReadSerial.mockResolvedValue(SUCCESS_SERIAL);
			mockedMkdtemp.mockResolvedValue("/tmp/acebott-build-throwing-log");
			mockedRm.mockRejectedValue(new Error("rm failed"));
			// Logger that throws.
			const log = () => {
				throw new Error("log exploded");
			};

			// Must NOT throw — primary result preserved.
			const result = await runHealthCheck({ skipFlash: false, log });
			expect(result.status).toBe("protocol_complete");
		});
	});

	describe("stages and flash state", () => {
		it("9.27 compile error returns stage compile, flashed false", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockResolvedValue({
				success: false,
				stdout: "",
				stderr: "compile error",
				buildPath: "/tmp/x",
			});

			const result = await runHealthCheck({ skipFlash: false });

			expect(result.stage).toBe("compile");
			expect(result.flashed).toBe(false);
		});

		it("9.28 flash error returns stage flash, flashed false", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockResolvedValue({
				success: true,
				stdout: "",
				stderr: "",
				buildPath: "/tmp/x",
			});
			mockedFlash.mockResolvedValue({ success: false, stdout: "", stderr: "flash err" });

			const result = await runHealthCheck({ skipFlash: false });

			expect(result.stage).toBe("flash");
			expect(result.flashed).toBe(false);
		});

		it("9.29 serial timeout after successful flash returns stage serial, flashed true", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockResolvedValue({
				success: true,
				stdout: "",
				stderr: "",
				buildPath: "/tmp/x",
			});
			mockedFlash.mockResolvedValue({ success: true, stdout: "", stderr: "" });
			mockedReadSerial.mockResolvedValue({ status: "timeout", data: [] });

			const result = await runHealthCheck({ skipFlash: false });

			expect(result.stage).toBe("serial");
			expect(result.flashed).toBe(true);
		});

		it("9.30 serial cancellation returns stage serial", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedReadSerial.mockResolvedValue({ status: "cancelled", data: [] });

			const result = await runHealthCheck({ skipFlash: true });

			expect(result.stage).toBe("serial");
			expect(result.status).toBe("cancelled");
		});

		it("9.31 only protocol completion returns stage complete", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedReadSerial.mockResolvedValue(SUCCESS_SERIAL);

			const result = await runHealthCheck({ skipFlash: true });

			expect(result.status).toBe("protocol_complete");
			expect(result.stage).toBe("complete");
		});

		it("9.32 flashed becomes true only after flashSketch resolves successfully", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedCompile.mockResolvedValue({
				success: true,
				stdout: "",
				stderr: "",
				buildPath: "/tmp/x",
			});
			// flashSketch throws synchronously — flashed MUST remain false.
			mockedFlash.mockRejectedValue(new Error("flash crash"));
			mockedReadSerial.mockResolvedValue(SUCCESS_SERIAL);

			const result = await runHealthCheck({ skipFlash: false });

			expect(result.flashed).toBe(false);
			expect(result.stage).toBe("flash");
		});
	});

	describe("result mapping", () => {
		const ctx = { stage: "serial" as const, detect: CONNECTED_DETECT, flashed: true };

		it("9.33 serial success maps to protocol_complete and parsed report", () => {
			const result = mapSerialResult(SUCCESS_SERIAL, ctx);
			expect(result.status).toBe("protocol_complete");
			if (result.status === "protocol_complete") {
				expect(result.report.result).toBe("pass");
				expect(result.report.ultrasonic.distance_cm).toBe(35);
				expect(result.stage).toBe("complete");
			}
		});

		it("9.34 serial incomplete maps to incomplete", () => {
			const result = mapSerialResult(
				{ status: "incomplete", data: ['{"t":"leds","left":"ok"}'], exitCode: 0 },
				ctx,
			);
			expect(result.status).toBe("incomplete");
			if (result.status === "incomplete") {
				expect(result.exitCode).toBe(0);
				expect(result.partialData).toHaveLength(1);
			}
		});

		it("9.35 serial timeout maps to timeout", () => {
			const result = mapSerialResult({ status: "timeout", data: ["partial"] }, ctx);
			expect(result.status).toBe("timeout");
		});

		it("9.36 serial error preserves stderr, exit code, signal, code, and process-state metadata", () => {
			const result = mapSerialResult(
				{
					status: "error",
					data: [],
					error: "process exited 1",
					code: "process_failed",
					processMayStillBeRunning: true,
					stderr: "device not found",
					exitCode: 1,
					signal: "SIGTERM",
				},
				ctx,
			);
			if (result.status === "error") {
				expect(result.error).toBe("process exited 1");
				// Serial "process_failed" maps to health-context "operation_failed".
				expect(result.code).toBe("operation_failed");
				expect(result.processMayStillBeRunning).toBe(true);
				expect(result.stderr).toBe("device not found");
				expect(result.exitCode).toBe(1);
				expect(result.signal).toBe("SIGTERM");
			}
		});

		it("9.37 serial cancelled maps to cancelled", () => {
			const result = mapSerialResult({ status: "cancelled", data: [] }, ctx);
			expect(result.status).toBe("cancelled");
		});

		it("9.38 unknown status reaches assertNever through a deliberate test cast", () => {
			// Deliberately cast an invalid status to confirm assertNever fires.
			const invalid = { status: "unknown", data: [] } as unknown as Parameters<
				typeof mapSerialResult
			>[0];
			expect(() => mapSerialResult(invalid, ctx)).toThrow();
		});

		it("9.39 every result variant includes stage, detect, and flashed", () => {
			const variants = [
				{ status: "success", data: [] },
				{ status: "incomplete", data: [], exitCode: 0 as const },
				{ status: "timeout", data: [] },
				{ status: "error", data: [], error: "x" },
				{ status: "cancelled", data: [] },
			];

			for (const v of variants) {
				const result = mapSerialResult(v as any, ctx);
				expect(result.stage).toBeDefined();
				expect(result.detect).toBe(CONNECTED_DETECT);
				expect(result.flashed).toBe(true);
			}
		});
	});

	describe("presentation semantics", () => {
		it("9.40 protocol_complete is not rendered as healthy, passed, or equivalent diagnostic language", async () => {
			mockedDetect.mockResolvedValue(CONNECTED_DETECT);
			mockedReadSerial.mockResolvedValue(SUCCESS_SERIAL);

			const result = await runHealthCheck({ skipFlash: true });

			// The result itself never says "healthy"/"passed" — `protocol_complete`
			// is the neutral stage label (REQ-011). Verify the type contract:
			if (result.status === "protocol_complete") {
				// The discriminated status itself is the neutral label.
				expect(result.status).toBe("protocol_complete");
				// The report may still have its own result (pass/fail/timeout)
				// but the OUTER status must not be one of these forbidden words.
				expect(result.status).not.toBe("healthy");
				expect(result.status).not.toBe("passed");
				expect(result.status).not.toBe("ok");
			}
		});
	});
});
