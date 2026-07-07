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

import { spawn } from "node:child_process";
import { compileSketch } from "../../src/lib/arduino-cli.js";

const mockedSpawn = vi.mocked(spawn);

function createMockProcess() {
	const proc = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
		kill: ReturnType<typeof vi.fn>;
	};
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.kill = vi.fn();
	return proc;
}

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

	it("abort signal kills process", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const controller = new AbortController();

		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
			signal: controller.signal,
		});

		// Abort before close
		controller.abort();

		expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");

		// Now resolve
		mockProc.emit("close", 0);

		const result = await resultPromise;
		expect(result.success).toBe(true);
	});

	it("kills immediately when signal already aborted", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const controller = new AbortController();
		controller.abort(); // abort before calling compileSketch

		const resultPromise = compileSketch({
			sketchPath: "/sketch",
			buildPath: "/build",
			signal: controller.signal,
		});

		// Process should be killed immediately
		expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");

		mockProc.emit("close", 0);

		const result = await resultPromise;
		expect(result.success).toBe(true);
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
		mockProc.emit("close", 0);

		const result = await resultPromise;

		expect(result.stdout).toBe("line 1\nline 2\n");
	});
});
