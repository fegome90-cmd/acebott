/**
 * Unit tests for hardware constants.
 * Validates every exported value matches real hardware specs.
 */

import { describe, expect, it } from "vitest";
import {
	AP,
	BAUD,
	CHIP,
	ESPTOOL_PATH,
	FLASH_OFFSETS,
	FQBN,
	PINS,
	SERIAL_TIMEOUT_MS,
} from "../../src/lib/constants.js";

describe("FQBN", () => {
	it("is esp32:esp32:esp32 (not arduino:esp32:esp32)", () => {
		expect(FQBN).toBe("esp32:esp32:esp32");
	});
});

describe("BAUD", () => {
	it("is 115200", () => {
		expect(BAUD).toBe(115200);
	});
});

describe("ESPTOOL_PATH", () => {
	it("points to ACECode bundled esptool", () => {
		expect(ESPTOOL_PATH).toContain("ACECode.app");
		expect(ESPTOOL_PATH).toContain("esptool");
	});
});

describe("FLASH_OFFSETS", () => {
	it("has bootloader at 0x1000", () => {
		expect(FLASH_OFFSETS.bootloader).toBe(0x1000);
	});

	it("has partitions at 0x8000", () => {
		expect(FLASH_OFFSETS.partitions).toBe(0x8000);
	});

	it("has boot_app0 at 0xe000", () => {
		expect(FLASH_OFFSETS.boot_app0).toBe(0xe000);
	});

	it("has firmware at 0x10000", () => {
		expect(FLASH_OFFSETS.firmware).toBe(0x10000);
	});

	it("has all four keys", () => {
		expect(Object.keys(FLASH_OFFSETS)).toHaveLength(4);
	});
});

describe("CHIP", () => {
	it("has vendorId 0x1a86", () => {
		expect(CHIP.vendorId).toBe(0x1a86);
	});

	it("has productId 0x7523", () => {
		expect(CHIP.productId).toBe(0x7523);
	});

	it("has vendorName WCH", () => {
		expect(CHIP.vendorName).toBe("WCH");
	});
});

describe("PINS", () => {
	it("has all expected keys", () => {
		const expectedKeys = [
			"motors",
			"ultrasonicTrig",
			"ultrasonicEcho",
			"servo",
			"ledLeft",
			"ledRight",
			"buzzer",
			"irReceiver",
			"trackingLeft",
			"trackingMiddle",
			"trackingRight",
		];
		expect(Object.keys(PINS).sort()).toEqual(expectedKeys.sort());
	});

	it("ultrasonicTrig is 13", () => {
		expect(PINS.ultrasonicTrig).toBe(13);
	});

	it("ultrasonicEcho is 14", () => {
		expect(PINS.ultrasonicEcho).toBe(14);
	});

	it("servo is 25", () => {
		expect(PINS.servo).toBe(25);
	});

	it("ledLeft is 12", () => {
		expect(PINS.ledLeft).toBe(12);
	});

	it("ledRight is 2", () => {
		expect(PINS.ledRight).toBe(2);
	});

	it("buzzer is 33", () => {
		expect(PINS.buzzer).toBe(33);
	});

	it("irReceiver is 4", () => {
		expect(PINS.irReceiver).toBe(4);
	});

	it("trackingLeft is 35", () => {
		expect(PINS.trackingLeft).toBe(35);
	});

	it("trackingMiddle is 36", () => {
		expect(PINS.trackingMiddle).toBe(36);
	});

	it("trackingRight is 39", () => {
		expect(PINS.trackingRight).toBe(39);
	});

	it("motors is ACB_SmartCar_V2 library", () => {
		expect(PINS.motors).toBe("ACB_SmartCar_V2");
	});
});

describe("AP", () => {
	it("has ssid ESP32-Car", () => {
		expect(AP.ssid).toBe("ESP32-Car");
	});

	it("has password 12345678", () => {
		expect(AP.password).toBe("12345678");
	});
});

describe("SERIAL_TIMEOUT_MS", () => {
	it("is 10000", () => {
		expect(SERIAL_TIMEOUT_MS).toBe(10_000);
	});
});
