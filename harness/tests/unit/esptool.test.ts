/**
 * Unit tests for esptool wrapper.
 * All spawn and access calls are mocked — no hardware access.
 */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process spawn
vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

// Mock fs/promises access
vi.mock("node:fs/promises", () => ({
	access: vi.fn(),
}));

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { BAUD, ESPTOOL_PATH, FLASH_OFFSETS } from "../../src/lib/constants.js";
import { checkEsptoolAvailable, EsptoolError, flashSketch } from "../../src/lib/esptool.js";

const mockedSpawn = vi.mocked(spawn);
const mockedAccess = vi.mocked(access);

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

/** Wait for microtasks to flush so flashSketch reaches spawn() */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("checkEsptoolAvailable", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns true when access succeeds", async () => {
		mockedAccess.mockResolvedValue(undefined);

		const result = await checkEsptoolAvailable();

		expect(result).toBe(true);
		expect(mockedAccess).toHaveBeenCalledWith(ESPTOOL_PATH);
	});

	it("returns false when access fails", async () => {
		mockedAccess.mockRejectedValue(new Error("ENOENT"));

		const result = await checkEsptoolAvailable();

		expect(result).toBe(false);
	});
});

describe("flashSketch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws EsptoolError when esptool not found", async () => {
		mockedAccess.mockRejectedValue(new Error("ENOENT"));

		await expect(
			flashSketch({
				buildPath: "/build",
				sketchName: "health_check",
				port: "/dev/cu.usbserial-110",
			}),
		).rejects.toThrow(EsptoolError);

		await expect(
			flashSketch({
				buildPath: "/build",
				sketchName: "health_check",
				port: "/dev/cu.usbserial-110",
			}),
		).rejects.toThrow("esptool not found");
	});

	it("spawns with correct args (baud 115200, all offsets)", async () => {
		mockedAccess.mockResolvedValue(undefined);
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
		});

		// Wait for flashSketch to reach spawn()
		await flush();

		// Now spawn has been called — emit close
		mockProc.emit("close", 0);

		await resultPromise;

		expect(mockedSpawn).toHaveBeenCalledWith(
			ESPTOOL_PATH,
			[
				"--chip",
				"esp32",
				"--port",
				"/dev/cu.usbserial-110",
				"--baud",
				String(BAUD),
				"--before",
				"default_reset",
				"--after",
				"hard_reset",
				"write_flash",
				"-z",
				"--flash_mode",
				"dio",
				"--flash_freq",
				"80m",
				"--flash_size",
				"detect",
				String(FLASH_OFFSETS.bootloader),
				"/build/health_check.ino.bootloader.bin",
				String(FLASH_OFFSETS.partitions),
				"/build/health_check.ino.partitions.bin",
				String(FLASH_OFFSETS.boot_app0),
				"/build/boot_app0.bin",
				String(FLASH_OFFSETS.firmware),
				"/build/health_check.ino.bin",
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
	});

	it("resolves success:true when exit code is 0", async () => {
		mockedAccess.mockResolvedValue(undefined);
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
		});

		await flush();

		mockProc.stdout?.emit("data", Buffer.from("Hash of data verified."));
		mockProc.emit("close", 0);

		const result = await resultPromise;

		expect(result.success).toBe(true);
		expect(result.stdout).toBe("Hash of data verified.");
	});

	it("resolves success:false when exit code is non-zero", async () => {
		mockedAccess.mockResolvedValue(undefined);
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
		});

		await flush();

		mockProc.stderr?.emit("data", Buffer.from("Invalid head of packet (0xE0)"));
		mockProc.emit("close", 1);

		const result = await resultPromise;

		expect(result.success).toBe(false);
		expect(result.stderr).toBe("Invalid head of packet (0xE0)");
	});

	it("resolves success:false on spawn error", async () => {
		mockedAccess.mockResolvedValue(undefined);
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
		});

		await flush();

		mockProc.emit("error", new Error("spawn ENOENT"));

		const result = await resultPromise;

		expect(result.success).toBe(false);
		expect(result.stderr).toContain("Spawn error: spawn ENOENT");
	});

	it("abort signal kills process", async () => {
		mockedAccess.mockResolvedValue(undefined);
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const controller = new AbortController();

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
			signal: controller.signal,
		});

		await flush();

		controller.abort();

		expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");

		mockProc.emit("close", 0);

		const result = await resultPromise;
		expect(result.success).toBe(true);
	});

	it("kills immediately when signal already aborted", async () => {
		mockedAccess.mockResolvedValue(undefined);
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const controller = new AbortController();
		controller.abort();

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
			signal: controller.signal,
		});

		await flush();

		// Process should be killed immediately (signal.aborted was true when spawn ran)
		expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");

		mockProc.emit("close", 0);

		const result = await resultPromise;
		expect(result.success).toBe(true);
	});

	it("onUpdate receives stdout chunks", async () => {
		mockedAccess.mockResolvedValue(undefined);
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const updates: string[] = [];

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
			onUpdate: (text) => updates.push(text),
		});

		await flush();

		mockProc.stdout?.emit("data", Buffer.from("Writing...\n"));
		mockProc.stdout?.emit("data", Buffer.from("Done.\n"));
		mockProc.emit("close", 0);

		await resultPromise;

		expect(updates).toHaveLength(2);
		expect(updates[0]).toBe("Writing...");
		expect(updates[1]).toBe("Done.");
	});
});
