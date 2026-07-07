/**
 * Unit tests for USB chip detection.
 * All exec calls are mocked — no hardware access.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process
vi.mock("node:child_process", () => ({
	exec: vi.fn(),
}));

import { exec } from "node:child_process";
import { detectChip } from "../../src/lib/usb.js";

const mockedExec = vi.mocked(exec);

describe("detectChip", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns ChipInfo when ioreg finds CH340", async () => {
		// ioreg output with CH340 vendor (6790) and product (29987)
		const ioregOutput = [
			"+-o Root  <class IORegistryEntry, id 1, ...>",
			"    +-o AppleUSBHostPort  <class AppleUSBHostPort, id ...>",
			"        +-o IOUSBHostDevice  <class IOUSBHostDevice, id ...>",
			'            "idVendor" = 6790',
			'            "idProduct" = 29987',
		].join("\n");

		mockedExec.mockImplementation((_cmd: string, _opts: unknown, cb: any) => {
			cb(null, { stdout: ioregOutput, stderr: "" });
			return undefined as any;
		});

		const result = await detectChip();

		expect(result).not.toBeNull();
		expect(result?.vendor).toBe("WCH");
		expect(result?.vendorId).toBe("0x1A86");
		expect(result?.productId).toBe("0x7523");
	});

	it("returns null when ioreg finds no CH340", async () => {
		const ioregOutput = [
			"+-o Root  <class IORegistryEntry, id 1, ...>",
			"    +-o AppleUSBHostPort  <class AppleUSBHostPort, id ...>",
			"        +-o IOUSBHostDevice  <class IOUSBHostDevice, id ...>",
			'            "idVendor" = 1452', // Apple vendor
			'            "idProduct" = 8220',
		].join("\n");

		mockedExec.mockImplementation((_cmd: string, _opts: unknown, cb: any) => {
			cb(null, { stdout: ioregOutput, stderr: "" });
			return undefined as any;
		});

		const result = await detectChip();

		expect(result).toBeNull();
	});

	it("falls back to system_profiler when ioreg fails", async () => {
		const systemProfilerOutput = JSON.stringify({
			SPUSBDataType: [
				{
					vendor_id: "0x1a86  (WCH)",
					product_id: "0x7523",
					_name: "USB-Serial Controller",
				},
			],
		});

		let callCount = 0;
		mockedExec.mockImplementation((_cmd: string, _opts: unknown, cb: any) => {
			callCount++;
			if (callCount === 1) {
				// ioreg fails
				cb(new Error("command not found"), { stdout: "", stderr: "error" });
			} else {
				// system_profiler succeeds
				cb(null, { stdout: systemProfilerOutput, stderr: "" });
			}
			return undefined as any;
		});

		const result = await detectChip();

		expect(result).not.toBeNull();
		expect(result?.vendor).toBe("WCH");
		expect(result?.vendorId).toBe("0x1A86");
	});

	it("returns null when both ioreg and system_profiler fail", async () => {
		mockedExec.mockImplementation((_cmd: string, _opts: unknown, cb: any) => {
			cb(new Error("command not found"), { stdout: "", stderr: "error" });
			return undefined as any;
		});

		const result = await detectChip();

		expect(result).toBeNull();
	});
});

describe("findCh340InJson (via system_profiler)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("finds CH340 in nested _items", async () => {
		const systemProfilerOutput = JSON.stringify({
			SPUSBDataType: [
				{
					_name: "Root Hub",
					_items: [
						{
							vendor_id: "0x1a86  (WCH)",
							product_id: "0x7523",
							_name: "USB-Serial Controller",
						},
					],
				},
			],
		});

		let callCount = 0;
		mockedExec.mockImplementation((_cmd: string, _opts: unknown, cb: any) => {
			callCount++;
			if (callCount === 1) {
				// ioreg fails
				cb(new Error("not found"), { stdout: "", stderr: "" });
			} else {
				cb(null, { stdout: systemProfilerOutput, stderr: "" });
			}
			return undefined as any;
		});

		const result = await detectChip();

		expect(result).not.toBeNull();
		expect(result?.vendor).toBe("WCH");
	});

	it("returns null when no CH340 in system_profiler JSON", async () => {
		const systemProfilerOutput = JSON.stringify({
			SPUSBDataType: [
				{
					vendor_id: "0x05ac  (Apple Inc.)",
					product_id: "0x0270",
					_name: "Keyboard",
				},
			],
		});

		let callCount = 0;
		mockedExec.mockImplementation((_cmd: string, _opts: unknown, cb: any) => {
			callCount++;
			if (callCount === 1) {
				cb(new Error("not found"), { stdout: "", stderr: "" });
			} else {
				cb(null, { stdout: systemProfilerOutput, stderr: "" });
			}
			return undefined as any;
		});

		const result = await detectChip();

		expect(result).toBeNull();
	});

	it("returns null when system_profiler JSON is invalid", async () => {
		let callCount = 0;
		mockedExec.mockImplementation((_cmd: string, _opts: unknown, cb: any) => {
			callCount++;
			if (callCount === 1) {
				cb(new Error("not found"), { stdout: "", stderr: "" });
			} else {
				cb(null, { stdout: "not json", stderr: "" });
			}
			return undefined as any;
		});

		const result = await detectChip();

		expect(result).toBeNull();
	});
});
