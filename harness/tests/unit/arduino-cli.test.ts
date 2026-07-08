/**
 * Unit tests for Arduino CLI wrapper.
 * All spawn calls are mocked — no hardware or arduino-cli access.
 */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process spawn
vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

// Mock terminateChild so wrapper lifecycle tests are fast and deterministic.
// The real terminateChild is unit-tested in child-process.test.ts.
vi.mock("../../src/lib/child-process.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/lib/child-process.js")>();
	return {
		...actual,
		terminateChild: vi.fn(actual.terminateChild),
	};
});

import { spawn } from "node:child_process";
import { compileSketch } from "../../src/lib/arduino-cli.js";
import { ChildTerminationError, terminateChild } from "../../src/lib/child-process.js";

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
	proc.kill = vi.fn((signal?: NodeJS.Signals | number | string) => {
		void signal;
		return true;
	});
	return proc;
}

/** Wait for microtasks to flush so the wrapper reaches spawn(). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("compileSketch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("spawns arduino-cli with correct args", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const opts = {
			sketchPath: "/path/to/sketch",
			buildPath: "/tmp/build-xxx",
		};

		compileSketch(opts);

		// Let the promise resolve
		mockProc.exitCode = 0;
		mockProc.emit("close", 0);

		expect(mockedSpawn).toHaveBeenCalledWith(
			"arduino-cli",
			[
				"compile",
				"--fqbn",
				"esp32:esp32:esp32",
				"--build-path",
				"/tmp/build-xxx",
				"/path/to/sketch",
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
	});

	it("resolves success:true when exit code is 0", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
		});

		mockProc.exitCode = 0;
		mockProc.emit("close", 0);

		const result = await resultPromise;

		expect(result.success).toBe(true);
		expect(result.buildPath).toBe("/build");
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("");
	});

	it("resolves success:false when exit code is 1", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
		});

		mockProc.stderr?.emit("data", Buffer.from("error: missing header"));
		mockProc.exitCode = 1;
		mockProc.emit("close", 1);

		const result = await resultPromise;

		expect(result.success).toBe(false);
		expect(result.stderr).toBe("error: missing header");
	});

	it("resolves success:false on spawn error", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
		});

		mockProc.emit("error", new Error("spawn ENOENT"));

		const result = await resultPromise;

		expect(result.success).toBe(false);
		expect(result.stderr).toContain("Spawn error: spawn ENOENT");
	});

	it("onUpdate receives stdout chunks", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const updates: string[] = [];

		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
			onUpdate: (text) => updates.push(text),
		});

		mockProc.stdout?.emit("data", Buffer.from("Compiling...\n"));
		mockProc.stdout?.emit("data", Buffer.from("Done.\n"));
		mockProc.exitCode = 0;
		mockProc.emit("close", 0);

		await resultPromise;

		expect(updates).toHaveLength(2);
		expect(updates[0]).toBe("Compiling...");
		expect(updates[1]).toBe("Done.");
	});

	it("collects stdout in result", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
		});

		mockProc.stdout?.emit("data", Buffer.from("line 1\n"));
		mockProc.stdout?.emit("data", Buffer.from("line 2\n"));
		mockProc.exitCode = 0;
		mockProc.emit("close", 0);

		const result = await resultPromise;

		expect(result.stdout).toBe("line 1\nline 2\n");
	});
});

/**
 * Wrapper lifecycle tests (design AD4, AD5, REQ-002).
 *
 * These verify the settle-once, termination-aware contract that compileSketch
 * must satisfy: abort sends SIGTERM, escalation to SIGKILL, ChildTerminationError
 * on unconfirmed termination, no settle before close, exactly-once settlement,
 * abort listener removed after normal completion.
 */
describe("compileSketch lifecycle (abort and race safety)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: terminateChild confirms termination (terminated via SIGTERM).
		mockedTerminateChild.mockResolvedValue({ status: "terminated", signal: "SIGTERM" });
	});

	it("abort sends SIGTERM to the compile process", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const controller = new AbortController();
		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
			signal: controller.signal,
		});

		await flush();

		controller.abort();

		// terminateChild was called (which sends SIGTERM internally).
		expect(mockedTerminateChild).toHaveBeenCalledWith(mockProc);
		await expect(resultPromise).rejects.toThrow(); // AbortError
	});

	it("failed SIGTERM escalates to SIGKILL", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		// terminateChild reports killed via SIGKILL (escalation happened inside).
		mockedTerminateChild.mockResolvedValue({ status: "killed", signal: "SIGKILL" });

		const controller = new AbortController();
		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
			signal: controller.signal,
		});

		await flush();

		controller.abort();

		await expect(resultPromise).rejects.toThrow(); // AbortError after SIGKILL confirmed
		expect(mockedTerminateChild).toHaveBeenCalledWith(mockProc);
	});

	it("unconfirmed termination rejects with ChildTerminationError", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		mockedTerminateChild.mockResolvedValue({
			status: "failed",
			error: "no closure after SIGKILL",
		});

		const controller = new AbortController();
		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
			signal: controller.signal,
		});

		await flush();

		controller.abort();

		await expect(resultPromise).rejects.toBeInstanceOf(ChildTerminationError);
	});

	it("the wrapper does not settle before close (normal path)", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		let settled = false;
		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
		}).then((r) => {
			settled = true;
			return r;
		});

		await flush();
		// Give a microtask cycle — should NOT have settled yet (no close).
		await new Promise<void>((resolve) => setTimeout(resolve, 10));

		expect(settled).toBe(false);

		mockProc.exitCode = 0;
		mockProc.emit("close", 0);

		await resultPromise;
		expect(settled).toBe(true);
	});

	it("abort and close race settles exactly once", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const controller = new AbortController();
		let resolveCount = 0;
		let rejectCount = 0;

		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
			signal: controller.signal,
		}).then(
			(r) => {
				resolveCount += 1;
				return r;
			},
			() => {
				rejectCount += 1;
			},
		);

		await flush();

		// Fire abort and close near-simultaneously.
		controller.abort();
		mockProc.exitCode = 0;
		mockProc.signalCode = "SIGTERM";
		mockProc.emit("close", 0, "SIGTERM");

		await resultPromise.catch(() => {});

		expect(resolveCount + rejectCount).toBe(1);
	});

	it("abort and process-error race settles exactly once", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const controller = new AbortController();
		let settleCount = 0;

		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
			signal: controller.signal,
		}).then(
			() => {
				settleCount += 1;
			},
			() => {
				settleCount += 1;
			},
		);

		await flush();

		controller.abort();
		mockProc.emit("error", new Error("spawn failed"));

		await resultPromise.catch(() => {});

		expect(settleCount).toBe(1);
	});

	it("failure inside the async abort path rejects the wrapper promise with no unhandled rejection", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		// terminateChild throws — the abort handler must route this through reject.
		mockedTerminateChild.mockRejectedValue(new Error("terminate exploded"));

		const controller = new AbortController();
		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
			signal: controller.signal,
		});

		await flush();

		controller.abort();

		// The wrapper must settle (reject) — no unhandled rejection.
		await expect(resultPromise).rejects.toBeTruthy();
	});

	it("abort listener is removed after normal completion", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const controller = new AbortController();
		const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
			signal: controller.signal,
		});

		await flush();

		// Normal completion (not aborted).
		mockProc.exitCode = 0;
		mockProc.emit("close", 0);

		await resultPromise;

		expect(removeSpy).toHaveBeenCalled();
	});

	it("abort listener is removed after abort path", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const controller = new AbortController();
		const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
			signal: controller.signal,
		});

		await flush();

		controller.abort();

		await resultPromise.catch(() => {});

		expect(removeSpy).toHaveBeenCalled();
	});
});
