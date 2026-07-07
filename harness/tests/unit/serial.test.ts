/**
 * Unit tests for serial reader.
 * All spawn calls are mocked — no hardware access.
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

import { spawn } from "node:child_process";
import { readSerial } from "../../src/lib/serial.js";

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

describe("readSerial", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

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

		expect(result).toHaveLength(2);
		expect(result[0]).toBe('{"t":"leds","left":"ok"}');
		expect(result[1]).toBe('{"t":"health","result":"pass"}');
	});

	it("stops on stopPredicate match", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = readSerial({
			port: "/dev/cu.usbserial-110",
			baud: 115200,
			timeoutMs: 5000,
			stopPredicate: (line) => line.includes('"health"'),
		});

		mockProc.stdout?.emit("data", Buffer.from('{"t":"health","result":"pass"}\n'));

		const result = await resultPromise;

		expect(result).toHaveLength(1);
		expect(result[0]).toBe('{"t":"health","result":"pass"}');
		expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
	});

	it("returns empty array on timeout (no matching lines)", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = readSerial({
			port: "/dev/cu.usbserial-110",
			baud: 115200,
			timeoutMs: 100,
		});

		mockProc.stdout?.emit("data", Buffer.from("hello world\n"));

		const result = await resultPromise;

		expect(result).toEqual([]);
	});

	it("handles abort signal", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const controller = new AbortController();

		const resultPromise = readSerial({
			port: "/dev/cu.usbserial-110",
			baud: 115200,
			timeoutMs: 5000,
			signal: controller.signal,
		});

		controller.abort();

		const result = await resultPromise;

		expect(result).toEqual([]);
	});

	it("handles process error event", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = readSerial({
			port: "/dev/cu.usbserial-110",
			baud: 115200,
			timeoutMs: 5000,
		});

		mockProc.emit("error", new Error("spawn failed"));

		const result = await resultPromise;

		expect(result).toEqual([]);
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
		mockProc.stdout?.emit("data", Buffer.from('s","left":"ok"}\n{"t":"health","result":"pass"}\n'));

		const result = await resultPromise;

		expect(result).toHaveLength(2);
		expect(result[0]).toBe('{"t":"leds","left":"ok"}');
		expect(result[1]).toBe('{"t":"health","result":"pass"}');
	});

	it("handles process close event", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = readSerial({
			port: "/dev/cu.usbserial-110",
			baud: 115200,
			timeoutMs: 5000,
		});

		mockProc.stdout?.emit("data", Buffer.from('{"t":"leds","left":"ok"}\n'));
		mockProc.emit("close", 0);

		const result = await resultPromise;

		expect(result).toHaveLength(1);
		expect(result[0]).toBe('{"t":"leds","left":"ok"}');
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

		expect(result).toHaveLength(2);
	});

	it("resolves once via finish guard (double resolve)", async () => {
		const mockProc = createMockProcess();
		mockedSpawn.mockReturnValue(mockProc as any);

		const resultPromise = readSerial({
			port: "/dev/cu.usbserial-110",
			baud: 115200,
			timeoutMs: 5000,
		});

		mockProc.stdout?.emit("data", Buffer.from('{"t":"health","result":"pass"}\n'));

		mockProc.emit("close", 0);

		const result = await resultPromise;

		expect(result).toHaveLength(1);
	});
});
