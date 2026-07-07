/**
 * Unit tests for robot_health tool logic.
 * All external functions are mocked — no hardware access.
 */

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
}));

import { exec } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { compileSketch } from "../../src/lib/arduino-cli.js";
import { flashSketch } from "../../src/lib/esptool.js";
import { readSerial } from "../../src/lib/serial.js";
import { detectRobot } from "../../src/tools/detect.js";
import { runHealthCheck } from "../../src/tools/health.js";

const mockedExec = vi.mocked(exec);
const mockedDetect = vi.mocked(detectRobot);
const mockedCompile = vi.mocked(compileSketch);
const mockedFlash = vi.mocked(flashSketch);
const mockedReadSerial = vi.mocked(readSerial);
const mockedMkdtemp = vi.mocked(mkdtemp);

describe("runHealthCheck", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedMkdtemp.mockResolvedValue("/tmp/acebott-build-xxx");
		// Default exec mock: calls callback with empty output (for pkill etc.)
		mockedExec.mockImplementation((_cmd: unknown, _opts: unknown, cb: any) => {
			// Handle both (cmd, cb) and (cmd, opts, cb) signatures
			if (typeof _opts === "function") {
				_opts(null, { stdout: "", stderr: "" });
			} else if (cb) {
				cb(null, { stdout: "", stderr: "" });
			}
			return undefined as any;
		});
	});

	it("throws when no robot detected", async () => {
		mockedDetect.mockResolvedValue({
			connected: false,
			port: null,
			chip: null,
			acecodeRunning: false,
			portBusy: false,
			esptoolAvailable: false,
			firmwareHint: "unknown",
		});

		await expect(runHealthCheck(false)).rejects.toThrow("No robot detected");
	});

	it("returns health report on successful full run", async () => {
		mockedDetect.mockResolvedValue({
			connected: true,
			port: "/dev/cu.usbserial-110",
			chip: null,
			acecodeRunning: false,
			portBusy: false,
			esptoolAvailable: true,
			firmwareHint: "unknown",
		});

		mockedCompile.mockResolvedValue({
			success: true,
			stdout: "Sketch uses 326323 bytes",
			stderr: "",
			buildPath: "/tmp/acebott-build-xxx",
		});

		mockedFlash.mockResolvedValue({
			success: true,
			stdout: "Hash of data verified.",
			stderr: "",
		});

		mockedReadSerial.mockResolvedValue([
			'{"t":"motors","fl":"ok","fr":"ok","bl":"ok","br":"ok"}',
			'{"t":"leds","left":"ok","right":"ok"}',
			'{"t":"buzzer","status":"ok"}',
			'{"t":"ultrasonic","distance_cm":35}',
			'{"t":"tracking","left":1100,"middle":900,"right":2000}',
			'{"t":"ir","code":"none"}',
			'{"t":"health","result":"pass"}',
		]);

		const result = await runHealthCheck(false);

		expect(result.report.result).toBe("pass");
		expect(result.report.leds.left).toBe("ok");
		expect(result.report.ultrasonic.distance_cm).toBe(35);
		expect(result.flashed).toBe(true);
		expect(mockedCompile).toHaveBeenCalledOnce();
		expect(mockedFlash).toHaveBeenCalledOnce();
	});

	it("skips flash when skipFlash is true", async () => {
		mockedDetect.mockResolvedValue({
			connected: true,
			port: "/dev/cu.usbserial-110",
			chip: null,
			acecodeRunning: false,
			portBusy: false,
			esptoolAvailable: true,
			firmwareHint: "unknown",
		});

		mockedReadSerial.mockResolvedValue(['{"t":"health","result":"pass"}']);

		const result = await runHealthCheck(true);

		expect(result.flashed).toBe(false);
		expect(mockedCompile).not.toHaveBeenCalled();
		expect(mockedFlash).not.toHaveBeenCalled();
	});

	it("throws when compile fails", async () => {
		mockedDetect.mockResolvedValue({
			connected: true,
			port: "/dev/cu.usbserial-110",
			chip: null,
			acecodeRunning: false,
			portBusy: false,
			esptoolAvailable: true,
			firmwareHint: "unknown",
		});

		mockedCompile.mockResolvedValue({
			success: false,
			stdout: "",
			stderr: "error: 'ACB_SmartCar_V2.h' file not found",
			buildPath: "/tmp/build",
		});

		await expect(runHealthCheck(false)).rejects.toThrow("Compile failed");
	});

	it("throws when flash fails", async () => {
		mockedDetect.mockResolvedValue({
			connected: true,
			port: "/dev/cu.usbserial-110",
			chip: null,
			acecodeRunning: false,
			portBusy: false,
			esptoolAvailable: true,
			firmwareHint: "unknown",
		});

		mockedCompile.mockResolvedValue({
			success: true,
			stdout: "",
			stderr: "",
			buildPath: "/tmp/build",
		});

		mockedFlash.mockResolvedValue({
			success: false,
			stdout: "",
			stderr: "Invalid head of packet (0xE0)",
		});

		await expect(runHealthCheck(false)).rejects.toThrow("Flash failed");
	});

	it("returns timeout when no serial output", async () => {
		mockedDetect.mockResolvedValue({
			connected: true,
			port: "/dev/cu.usbserial-110",
			chip: null,
			acecodeRunning: false,
			portBusy: false,
			esptoolAvailable: true,
			firmwareHint: "unknown",
		});

		mockedReadSerial.mockResolvedValue([]);

		const result = await runHealthCheck(true);

		expect(result.report.result).toBe("timeout");
	});

	it("throws when ACECode is running and no ctx", async () => {
		mockedDetect.mockResolvedValue({
			connected: true,
			port: "/dev/cu.usbserial-110",
			chip: null,
			acecodeRunning: true,
			portBusy: false,
			esptoolAvailable: true,
			firmwareHint: "unknown",
		});

		await expect(runHealthCheck(false)).rejects.toThrow("ACECode is running");
	});

	it("kills ACECode and proceeds when user confirms", async () => {
		mockedDetect.mockResolvedValue({
			connected: true,
			port: "/dev/cu.usbserial-110",
			chip: null,
			acecodeRunning: true,
			portBusy: false,
			esptoolAvailable: true,
			firmwareHint: "unknown",
		});

		mockedCompile.mockResolvedValue({
			success: true,
			stdout: "",
			stderr: "",
			buildPath: "/tmp/build",
		});

		mockedFlash.mockResolvedValue({
			success: true,
			stdout: "",
			stderr: "",
		});

		mockedReadSerial.mockResolvedValue(['{"t":"health","result":"pass"}']);

		// Mock ctx with hasUI and confirm returning true
		const mockCtx = {
			hasUI: true,
			ui: {
				confirm: vi.fn().mockResolvedValue(true),
			},
		};

		const result = await runHealthCheck(false, mockCtx as any);

		expect(mockCtx.ui.confirm).toHaveBeenCalledWith(
			"ACECode is running and may hold the serial port.",
			"Kill ACECode and proceed with health check?",
		);
		expect(result.report.result).toBe("pass");
		expect(result.flashed).toBe(true);
	});

	it("throws when user declines to kill ACECode", async () => {
		mockedDetect.mockResolvedValue({
			connected: true,
			port: "/dev/cu.usbserial-110",
			chip: null,
			acecodeRunning: true,
			portBusy: false,
			esptoolAvailable: true,
			firmwareHint: "unknown",
		});

		const mockCtx = {
			hasUI: true,
			ui: {
				confirm: vi.fn().mockResolvedValue(false),
			},
		};

		await expect(runHealthCheck(false, mockCtx as any)).rejects.toThrow(
			"Flash aborted: ACECode is running and user declined to kill it",
		);

		expect(mockCtx.ui.confirm).toHaveBeenCalledOnce();
		expect(mockedCompile).not.toHaveBeenCalled();
		expect(mockedFlash).not.toHaveBeenCalled();
	});
});
