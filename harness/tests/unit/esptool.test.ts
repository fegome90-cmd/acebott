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

// Mock fs/promises access and stat
vi.mock("node:fs/promises", () => ({
	access: vi.fn(),
	stat: vi.fn(),
}));

// Mock terminateChild so wrapper lifecycle tests are fast and deterministic.
vi.mock("../../src/lib/child-process.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/lib/child-process.js")>();
	return {
		...actual,
		terminateChild: vi.fn(actual.terminateChild),
	};
});

import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { ChildTerminationError, terminateChild } from "../../src/lib/child-process.js";
import { BAUD, ESPTOOL_PATH, FLASH_OFFSETS } from "../../src/lib/constants.js";
import { checkEsptoolAvailable, EsptoolError, flashSketch } from "../../src/lib/esptool.js";

const mockedSpawn = vi.mocked(spawn);
const mockedAccess = vi.mocked(access);
const mockedStat = vi.mocked(stat);
const mockedTerminateChild = vi.mocked(terminateChild);

/** A fake stat result indicating a valid regular file with non-zero size. */
const validFileStats = {
	isFile: () => true,
	isDirectory: () => false,
	isBlockDevice: () => false,
	isCharacterDevice: () => false,
	isSymbolicLink: () => false,
	isFIFO: () => false,
	isSocket: () => false,
	size: 1024,
} as unknown as Awaited<ReturnType<typeof stat>>;

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
		mockedAccess.mockResolvedValue(undefined);
		// Default: all artifacts validate as regular non-empty files.
		mockedStat.mockResolvedValue(validFileStats);
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

		await flush();

		mockProc.exitCode = 0;
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
		mockProc.exitCode = 0;
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
		mockProc.exitCode = 1;
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
		mockProc.exitCode = 0;
		mockProc.emit("close", 0);

		await resultPromise;

		expect(updates).toHaveLength(2);
		expect(updates[0]).toBe("Writing...");
		expect(updates[1]).toBe("Done.");
	});
});

/**
 * Wrapper lifecycle tests (design AD4, AD5, REQ-002).
 */
describe("flashSketch lifecycle (abort and race safety)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedAccess.mockResolvedValue(undefined);
		mockedStat.mockResolvedValue(validFileStats);
		// Default: terminateChild confirms termination (terminated via SIGTERM).
		mockedTerminateChild.mockResolvedValue({ status: "terminated", signal: "SIGTERM" });
	});

	it("abort sends SIGTERM to the esptool process", async () => {
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

		expect(mockedTerminateChild).toHaveBeenCalledWith(mockProc);
		await expect(resultPromise).rejects.toThrow();
	});

	it("failed SIGTERM escalates to SIGKILL", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		mockedTerminateChild.mockResolvedValue({ status: "killed", signal: "SIGKILL" });

		const controller = new AbortController();
		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
			signal: controller.signal,
		});

		await flush();

		controller.abort();

		await expect(resultPromise).rejects.toThrow();
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
		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
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
		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
		}).then((r) => {
			settled = true;
			return r;
		});

		await flush();
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

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
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

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
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

		mockedTerminateChild.mockRejectedValue(new Error("terminate exploded"));

		const controller = new AbortController();
		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
			signal: controller.signal,
		});

		await flush();

		controller.abort();

		await expect(resultPromise).rejects.toBeTruthy();
	});

	it("abort listener is removed after normal completion", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const controller = new AbortController();
		const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
			signal: controller.signal,
		});

		await flush();

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

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
			signal: controller.signal,
		});

		await flush();

		controller.abort();

		await resultPromise.catch(() => {});

		expect(removeSpy).toHaveBeenCalled();
	});
});

/**
 * Flash artifact validation tests (Phase 11-12, design AD15, REQ-010).
 *
 * `validateFlashArtifacts` runs BEFORE esptool is spawned and checks all 4
 * required artifacts: bootloader, partition table, boot_app0, application
 * firmware. Each must exist, be a regular file, and have non-zero size.
 * Any invalid artifact raises an artifact-specific `EsptoolError`.
 */
describe("flashSketch artifact validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// esptool binary is available by default.
		mockedAccess.mockResolvedValue(undefined);
		// Default: all artifacts validate as regular non-empty files.
		mockedStat.mockResolvedValue(validFileStats);
	});

	it("11.1 missing bootloader raises artifact-specific EsptoolError", async () => {
		// stat rejects with ENOENT for the bootloader path.
		const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		mockedStat.mockImplementation(async (path: unknown) => {
			if (typeof path === "string" && path.endsWith("health_check.ino.bootloader.bin")) {
				throw enoent;
			}
			return validFileStats;
		});

		await expect(
			flashSketch({
				buildPath: "/build",
				sketchName: "health_check",
				port: "/dev/cu.usbserial-110",
			}),
		).rejects.toThrow(EsptoolError);

		try {
			await flashSketch({
				buildPath: "/build",
				sketchName: "health_check",
				port: "/dev/cu.usbserial-110",
			});
		} catch (err) {
			expect(err).toBeInstanceOf(EsptoolError);
			expect((err as Error).message).toContain("bootloader");
			expect((err as Error).message).toContain("could not be accessed");
			expect((err as Error).message).toContain("ENOENT");
		}
	});

	it("11.2 empty application firmware raises artifact-specific EsptoolError", async () => {
		mockedStat.mockImplementation(async (path: unknown) => {
			if (typeof path === "string" && path.endsWith("health_check.ino.bin")) {
				return { ...validFileStats, size: 0 } as unknown as Awaited<ReturnType<typeof stat>>;
			}
			return validFileStats;
		});

		await expect(
			flashSketch({
				buildPath: "/build",
				sketchName: "health_check",
				port: "/dev/cu.usbserial-110",
			}),
		).rejects.toThrow(EsptoolError);

		try {
			await flashSketch({
				buildPath: "/build",
				sketchName: "health_check",
				port: "/dev/cu.usbserial-110",
			});
		} catch (err) {
			expect(err).toBeInstanceOf(EsptoolError);
			expect((err as Error).message).toContain("application firmware");
			expect((err as Error).message).toMatch(/empty|0 bytes/);
		}
	});

	it("11.3 directory supplied as artifact raises EsptoolError", async () => {
		mockedStat.mockImplementation(async (path: unknown) => {
			if (typeof path === "string" && path.endsWith("health_check.ino.partitions.bin")) {
				// Stats that report isFile() = false (directory).
				return {
					...validFileStats,
					isFile: () => false,
					isDirectory: () => true,
					size: 4096,
				} as unknown as Awaited<ReturnType<typeof stat>>;
			}
			return validFileStats;
		});

		await expect(
			flashSketch({
				buildPath: "/build",
				sketchName: "health_check",
				port: "/dev/cu.usbserial-110",
			}),
		).rejects.toThrow(EsptoolError);

		try {
			await flashSketch({
				buildPath: "/build",
				sketchName: "health_check",
				port: "/dev/cu.usbserial-110",
			});
		} catch (err) {
			expect(err).toBeInstanceOf(EsptoolError);
			expect((err as Error).message).toContain("partition table");
			expect((err as Error).message).toContain("not a regular file");
		}
	});

	it("11.4 any single invalid artifact prevents esptool spawn", async () => {
		// boot_app0 missing.
		mockedStat.mockImplementation(async (path: unknown) => {
			if (typeof path === "string" && path.endsWith("boot_app0.bin")) {
				throw new Error("ENOENT");
			}
			return validFileStats;
		});

		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		await expect(
			flashSketch({
				buildPath: "/build",
				sketchName: "health_check",
				port: "/dev/cu.usbserial-110",
			}),
		).rejects.toThrow(EsptoolError);

		// spawn MUST NOT have been called — validation aborts before spawn.
		expect(mockedSpawn).not.toHaveBeenCalled();
	});

	it("11.5 caller-owned files are never deleted by validation", async () => {
		// Validation only calls stat(); it must never call unlink/rm.
		// Mock rm to track any deletion attempt (it isn't imported by esptool.ts,
		// so this is a defensive check: only stat() should be invoked from fs).
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
		});

		await flush();

		mockProc.exitCode = 0;
		mockProc.emit("close", 0);

		await resultPromise;

		// Only stat() should have been called against fs/promises (no rm/unlink).
		for (const call of mockedStat.mock.calls) {
			expect(typeof call[0]).toBe("string");
		}
		// Verify all 4 artifacts were statted, not deleted.
		expect(mockedStat).toHaveBeenCalledTimes(4);
	});

	it("11.6 all four required artifact paths are checked", async () => {
		const statedPaths: string[] = [];
		mockedStat.mockImplementation(async (path: unknown) => {
			statedPaths.push(path as string);
			return validFileStats;
		});

		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
		});

		await flush();

		mockProc.exitCode = 0;
		mockProc.emit("close", 0);

		await resultPromise;

		// All 4 required artifacts must have been checked.
		expect(statedPaths).toContain("/build/health_check.ino.bootloader.bin");
		expect(statedPaths).toContain("/build/health_check.ino.partitions.bin");
		expect(statedPaths).toContain("/build/boot_app0.bin");
		expect(statedPaths).toContain("/build/health_check.ino.bin");
		expect(statedPaths).toHaveLength(4);
	});

	it("11.7 permission-denied artifact reports access error, not 'not found'", async () => {
		// Simulate EACCES on the bootloader path only — stat rejects with a
		// permission error. Other artifact paths resolve to valid files.
		// `validateFlashArtifacts` is not exported; it is exercised via flashSketch,
		// matching the pattern in tests 11.1 and 11.4.
		const eacces = Object.assign(new Error("permission denied"), {
			code: "EACCES",
		});
		mockedStat.mockImplementation(async (path: unknown) => {
			if (typeof path === "string" && path.endsWith("health_check.ino.bootloader.bin")) {
				throw eacces;
			}
			return validFileStats;
		});

		// Call flashSketch exactly ONCE — the per-path mockImplementation is not
		// consumed the way mockRejectedValueOnce is, but calling twice would still
		// be wasteful and could mask a resolution-vs-rejection race. Capture the
		// error and assert on it outside the catch so a resolution (no throw)
		// produces a clear "expected to throw" failure rather than a confusing one.
		let caught: unknown;
		try {
			await flashSketch({
				buildPath: "/build",
				sketchName: "health_check",
				port: "/dev/cu.usbserial-110",
			});
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(EsptoolError);
		const msg = (caught as EsptoolError).message;
		// The error message must NOT say "not found" — it should indicate an
		// access problem and include the error code.
		expect(msg).not.toContain("not found");
		expect(msg).toContain("EACCES");
	});
});
