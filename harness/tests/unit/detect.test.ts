/**
 * Unit tests for robot_detect tool logic.
 * All external commands are mocked — no hardware access.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process exec
vi.mock("node:child_process", () => ({
	exec: vi.fn(),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
	readdir: vi.fn(),
	access: vi.fn(),
}));

// Mock usb detection
vi.mock("../../src/lib/usb.js", () => ({
	detectChip: vi.fn(),
}));

import { exec } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { detectChip } from "../../src/lib/usb.js";
import { detectRobot } from "../../src/tools/detect.js";

const mockedExec = vi.mocked(exec);
const mockedReaddir = vi.mocked(readdir);
const mockedAccess = vi.mocked(access);
const mockedDetectChip = vi.mocked(detectChip);

// Helper to mock promisify(exec) — the module uses promisify internally
// We need to mock the actual exec callback behavior
function mockExec(result: { stdout: string; stderr: string } | Error) {
	mockedExec.mockImplementation((_cmd: string, _opts: unknown, cb: any) => {
		if (result instanceof Error) {
			cb(result, { stdout: "", stderr: result.message });
		} else {
			cb(null, result);
		}
		return undefined as any;
	});
}

describe("detectRobot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedAccess.mockResolvedValue(undefined); // esptool exists
	});

	it("returns connected: true when port found and chip detected", async () => {
		mockedReaddir.mockResolvedValue(["cu.usbserial-110" as any, "tty.usbserial-110" as any]);
		mockedDetectChip.mockResolvedValue({
			vendor: "WCH",
			vendorId: "0x1A86",
			productId: "0x7523",
		});
		mockExec({ stdout: "", stderr: "" }); // pgrep returns empty = not running, lsof returns empty = not busy

		const result = await detectRobot();

		expect(result.connected).toBe(true);
		expect(result.port).toBe("/dev/cu.usbserial-110");
		expect(result.chip?.vendor).toBe("WCH");
		expect(result.chip?.vendorId).toBe("0x1A86");
	});

	it("returns connected: false when no port found", async () => {
		mockedReaddir.mockResolvedValue([]);
		mockedDetectChip.mockResolvedValue(null);
		mockExec(new Error("not found"));

		const result = await detectRobot();

		expect(result.connected).toBe(false);
		expect(result.port).toBeNull();
	});

	it("returns acecodeRunning: true when pgrep finds process", async () => {
		mockedReaddir.mockResolvedValue(["cu.usbserial-110" as any]);
		mockedDetectChip.mockResolvedValue(null);
		// pgrep returns PID → ACECode is running
		let _callCount = 0;
		mockedExec.mockImplementation((_cmd: string, _opts: unknown, cb: any) => {
			_callCount++;
			if (_cmd.includes("pgrep")) {
				cb(null, { stdout: "12345\n", stderr: "" });
			} else {
				// lsof returns empty
				cb(null, { stdout: "", stderr: "" });
			}
			return undefined as any;
		});

		const result = await detectRobot();

		expect(result.acecodeRunning).toBe(true);
	});

	it("returns portBusy: true when lsof finds process holding port", async () => {
		mockedReaddir.mockResolvedValue(["cu.usbserial-110" as any]);
		mockedDetectChip.mockResolvedValue(null);
		mockedExec.mockImplementation((_cmd: string, _opts: unknown, cb: any) => {
			if (_cmd.includes("lsof")) {
				cb(null, { stdout: "COMMAND PID\nACECode 1234\n", stderr: "" });
			} else {
				cb(new Error("no match"), { stdout: "", stderr: "" });
			}
			return undefined as any;
		});

		const result = await detectRobot();

		expect(result.portBusy).toBe(true);
	});

	it("returns esptoolAvailable: false when access fails", async () => {
		mockedReaddir.mockResolvedValue(["cu.usbserial-110" as any]);
		mockedDetectChip.mockResolvedValue(null);
		mockExec({ stdout: "", stderr: "" });
		mockedAccess.mockRejectedValue(new Error("ENOENT"));

		const result = await detectRobot();

		expect(result.esptoolAvailable).toBe(false);
	});

	it("respects port override parameter", async () => {
		mockedReaddir.mockResolvedValue([]);
		mockedDetectChip.mockResolvedValue(null);
		mockExec({ stdout: "", stderr: "" });

		const result = await detectRobot("/dev/cu.usbserial-999");

		// Should use the override port, not scan /dev/
		expect(result.port).toBe("/dev/cu.usbserial-999");
		expect(result.connected).toBe(true);
		expect(mockedReaddir).not.toHaveBeenCalled();
	});

	it("picks first cu.usbserial when multiple ports found", async () => {
		mockedReaddir.mockResolvedValue([
			"cu.usbserial-110" as any,
			"cu.usbserial-220" as any,
			"tty.usbserial-110" as any,
		]);
		mockedDetectChip.mockResolvedValue(null);
		mockExec({ stdout: "", stderr: "" });

		const result = await detectRobot();

		expect(result.connected).toBe(true);
		expect(result.port).toBe("/dev/cu.usbserial-110");
	});

	it("returns firmwareHint unknown", async () => {
		mockedReaddir.mockResolvedValue([]);
		mockedDetectChip.mockResolvedValue(null);
		mockExec({ stdout: "", stderr: "" });

		const result = await detectRobot();

		expect(result.firmwareHint).toBe("unknown");
	});

	it("detects chip info when present", async () => {
		mockedReaddir.mockResolvedValue(["cu.usbserial-110" as any]);
		mockedDetectChip.mockResolvedValue({
			vendor: "WCH",
			vendorId: "0x1A86",
			productId: "0x7523",
		});
		mockExec({ stdout: "", stderr: "" });

		const result = await detectRobot();

		expect(result.chip).toEqual({
			vendor: "WCH",
			vendorId: "0x1A86",
			productId: "0x7523",
		});
	});
});
