/**
 * Unit tests for serial reader.
 * All spawn calls are mocked — no hardware access.
 *
 * Covers Phase 7 RED: discriminated SerialReadResult contract, two-phase
 * selectResult/finalize settlement, stderr capture, listener/timer cleanup,
 * and termination-failure priority.
 */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process spawn
vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

// Mock validate.ts (needed by serial.ts)
vi.mock("../../src/lib/validate.js", () => ({
	validatePort: vi.fn((port: string) => port),
	isValidPort: vi.fn(() => true),
}));

// Mock terminateChild so finalize tests are fast and deterministic.
// The real terminateChild is unit-tested in child-process.test.ts.
vi.mock("../../src/lib/child-process.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/lib/child-process.js")>();
	return {
		...actual,
		terminateChild: vi.fn(actual.terminateChild),
	};
});

import { spawn } from "node:child_process";
import { terminateChild } from "../../src/lib/child-process.js";
import { readSerial } from "../../src/lib/serial.js";

const mockedSpawn = vi.mocked(spawn);
const mockedTerminateChild = vi.mocked(terminateChild);

function createMockProcess() {
	const proc = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
		exitCode: number | null;
		signalCode: NodeJS.Signals | null;
		kill: ReturnType<typeof vi.fn>;
	};
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.exitCode = null;
	proc.signalCode = null;
	proc.kill = vi.fn();
	return proc;
}

/** Default termination result: process confirmed closed by SIGTERM. */
const TERMINATED = { status: "terminated" as const, signal: "SIGTERM" as const };
/** Failed termination result: closure could not be confirmed. */
const TERMINATION_FAILED = { status: "failed" as const, error: "kill timed out" };

describe("readSerial", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// By default, terminateChild reports a clean SIGTERM closure.
		mockedTerminateChild.mockResolvedValue(TERMINATED);
	});

	describe("discriminated result contract", () => {
		it("7.1 stop predicate reached returns success", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
			});

			mockProc.stdout?.emit("data", Buffer.from('{"t":"health","result":"pass"}\n'));

			const resolved = await result;
			expect(resolved.status).toBe("success");
			if (resolved.status === "success") {
				expect(resolved.data).toHaveLength(1);
				expect(resolved.data[0]).toBe('{"t":"health","result":"pass"}');
			}
		});

		it("7.2 exit code 0 without marker returns incomplete with exitCode 0", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
			});

			mockProc.stdout?.emit("data", Buffer.from('{"t":"leds","left":"ok"}\n'));
			mockProc.exitCode = 0;
			mockProc.emit("close", 0);

			const resolved = await result;
			expect(resolved.status).toBe("incomplete");
			if (resolved.status === "incomplete") {
				expect(resolved.exitCode).toBe(0);
				expect(resolved.data).toHaveLength(1);
			}
		});

		it("7.3 non-zero exit returns error with stderr and exit code", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
			});

			mockProc.stderr?.emit("data", Buffer.from("serial.SerialException: device not found\n"));
			mockProc.exitCode = 1;
			mockProc.emit("close", 1);

			const resolved = await result;
			expect(resolved.status).toBe("error");
			if (resolved.status === "error") {
				expect(resolved.exitCode).toBe(1);
				expect(resolved.stderr).toContain("device not found");
				expect(resolved.data).toHaveLength(0);
			}
		});

		it("7.4 spawn failure returns error", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
			});

			mockProc.emit("error", new Error("spawn uv ENOENT"));

			const resolved = await result;
			expect(resolved.status).toBe("error");
			if (resolved.status === "error") {
				expect(resolved.error).toContain("spawn");
			}
		});

		it("7.5 timeout returns timeout with partial data", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 50,
			});

			mockProc.stdout?.emit("data", Buffer.from('{"t":"leds","left":"ok"}\n'));

			const resolved = await result;
			expect(resolved.status).toBe("timeout");
			if (resolved.status === "timeout") {
				expect(resolved.data).toHaveLength(1);
				expect(resolved.data[0]).toBe('{"t":"leds","left":"ok"}');
			}
		});

		it("7.6 abort before start returns cancelled", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const controller = new AbortController();
			controller.abort();

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
				signal: controller.signal,
			});

			const resolved = await result;
			expect(resolved.status).toBe("cancelled");
			if (resolved.status === "cancelled") {
				expect(resolved.data).toHaveLength(0);
			}
		});

		it("7.6b abort before start does not call terminateChild", async () => {
			// The pre-spawn abort path must NOT invoke terminateChild — there is no
			// process to terminate. This test fails if finalize passes undefined
			// to terminateChild instead of short-circuiting.
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const controller = new AbortController();
			controller.abort();

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
				signal: controller.signal,
			});

			const resolved = await result;
			expect(resolved.status).toBe("cancelled");
			// Critical: terminateChild must NOT be called when no process was spawned.
			expect(mockedTerminateChild).not.toHaveBeenCalled();
		});

		it("7.7 abort before timeout callback returns cancelled", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const controller = new AbortController();

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
				signal: controller.signal,
			});

			// Abort before the timeout fires.
			controller.abort();

			const resolved = await result;
			expect(resolved.status).toBe("cancelled");
		});

		it("7.8 timeout selected before abort remains timeout", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const controller = new AbortController();

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 50,
				signal: controller.signal,
			});

			// Wait for the timeout to fire first (fires at timeoutMs + 2000 buffer).
			await new Promise((r) => setTimeout(r, 2150));
			controller.abort();

			const resolved = await result;
			expect(resolved.status).toBe("timeout");
		});

		it("7.9 stop predicate selected before close remains success", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
			});

			mockProc.stdout?.emit("data", Buffer.from('{"t":"health","result":"pass"}\n'));
			// Then a close with code 0 arrives after stop predicate already fired.
			mockProc.exitCode = 0;
			mockProc.emit("close", 0);

			const resolved = await result;
			expect(resolved.status).toBe("success");
		});
	});

	describe("listener and timer cleanup", () => {
		it("7.10 listeners and timer are removed before final resolution", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const controller = new AbortController();
			const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
				signal: controller.signal,
			});

			mockProc.stdout?.emit("data", Buffer.from('{"t":"health","result":"pass"}\n'));

			await result;

			// Abort listener removed after settlement.
			expect(removeSpy).toHaveBeenCalled();
			// No close listeners left on the process.
			expect(mockProc.listenerCount("close")).toBe(0);
			expect(mockProc.listenerCount("error")).toBe(0);
		});

		it("7.11 final result resolves exactly once", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
			});

			mockProc.stdout?.emit("data", Buffer.from('{"t":"health","result":"pass"}\n'));
			// Re-attach a noop error listener so emitting close/error after
			// settlement doesn't crash Node (listeners were removed by finalize).
			mockProc.on("error", () => {});
			mockProc.emit("close", 0);
			mockProc.emit("error", new Error("late error"));

			const resolved = await result;
			expect(resolved.status).toBe("success");
		});
	});

	describe("termination-failure priority", () => {
		it("7.12 termination failure after selected success returns error", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);
			mockedTerminateChild.mockResolvedValue(TERMINATION_FAILED);

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
			});

			mockProc.stdout?.emit("data", Buffer.from('{"t":"health","result":"pass"}\n'));

			const resolved = await result;
			expect(resolved.status).toBe("error");
		});

		it("7.13 termination failure after selected timeout returns error", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);
			mockedTerminateChild.mockResolvedValue(TERMINATION_FAILED);

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 50,
			});

			const resolved = await result;
			expect(resolved.status).toBe("error");
		});

		it("7.14 termination failure after selected cancellation returns error", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);
			mockedTerminateChild.mockResolvedValue(TERMINATION_FAILED);

			const controller = new AbortController();

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
				signal: controller.signal,
			});

			controller.abort();

			const resolved = await result;
			expect(resolved.status).toBe("error");
		});

		it("7.15 termination-failure result includes child_termination_unconfirmed and processMayStillBeRunning", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);
			mockedTerminateChild.mockResolvedValue(TERMINATION_FAILED);

			const result = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
			});

			mockProc.stdout?.emit("data", Buffer.from('{"t":"health","result":"pass"}\n'));

			const resolved = await result;
			expect(resolved.status).toBe("error");
			if (resolved.status === "error") {
				expect(resolved.code).toBe("child_termination_unconfirmed");
				expect(resolved.processMayStillBeRunning).toBe(true);
				expect(resolved.error).toBeTruthy();
			}
		});
	});

	describe("preserved behavioral tests (migrated to new contract)", () => {
		it("collects lines matching linePredicate", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const resultPromise = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 1000,
			});

			mockProc.stdout?.emit(
				"data",
				Buffer.from('{"t":"leds","left":"ok"}\n{"t":"health","result":"pass"}\n'),
			);

			const result = await resultPromise;
			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.data).toHaveLength(2);
			}
		});

		it("routes termination through terminateChild when stop predicate matches", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const resultPromise = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
				stopPredicate: (line) => line.includes('"health"'),
			});

			mockProc.stdout?.emit("data", Buffer.from('{"t":"health","result":"pass"}\n'));

			await resultPromise;
			// terminateChild is the canonical termination path (design AD8).
			expect(mockedTerminateChild).toHaveBeenCalledWith(mockProc);
		});

		it("handles correct buffer splitting for partial lines", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const resultPromise = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
			});

			mockProc.stdout?.emit("data", Buffer.from('{"t":"led'));
			mockProc.stdout?.emit(
				"data",
				Buffer.from('s","left":"ok"}\n{"t":"health","result":"pass"}\n'),
			);

			const result = await resultPromise;
			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.data).toHaveLength(2);
				expect(result.data[0]).toBe('{"t":"leds","left":"ok"}');
			}
		});

		it("skips empty lines", async () => {
			const mockProc = createMockProcess();
			mockedSpawn.mockReturnValue(mockProc as any);

			const resultPromise = readSerial({
				port: "/dev/cu.usbserial-110",
				baud: 115200,
				timeoutMs: 5000,
			});

			mockProc.stdout?.emit(
				"data",
				Buffer.from('\n\n{"t":"leds","left":"ok"}\n\n{"t":"health","result":"pass"}\n'),
			);

			const result = await resultPromise;
			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.data).toHaveLength(2);
			}
		});
	});
});
