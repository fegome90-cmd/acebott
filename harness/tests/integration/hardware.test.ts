/**
 * Integration tests for robot_detect and robot_health.
 *
 * These tests run against REAL hardware. They are SKIPPED by default.
 * To enable: set ACEBOTT_HW=1 before running.
 *
 *   ACEBOTT_HW=1 pnpm test:integration
 *
 * Prerequisites:
 * - Acebott QD001 connected via USB
 * - ACECode not running (pkill -9 -f ACECode)
 * - arduino-cli installed with esp32 core
 * - uv + pyserial available
 */

import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { detectRobot } from "../../src/tools/detect.js";
import { runHealthCheck } from "../../src/tools/health.js";

const HARDWARE_ENABLED = process.env.ACEBOTT_HW === "1";

describe.skipIf(!HARDWARE_ENABLED)("robot_detect (hardware)", () => {
	it("detects a connected Acebott QD001", async () => {
		const result = await detectRobot();

		expect(result.connected).toBe(true);
		expect(result.port).toMatch(/\/dev\/cu\.usbserial/);
		expect(result.chip).not.toBeNull();
		expect(result.chip?.vendorId).toBe("0x1A86");
		expect(result.acecodeRunning).toBe(false);
	});
});

describe.skipIf(!HARDWARE_ENABLED)("robot_health (hardware)", () => {
	beforeAll(() => {
		// Ensure ACECode is not running
		if (HARDWARE_ENABLED) {
			try {
				execSync("pkill -9 -f ACECode", { timeout: 3000 });
			} catch {
				// ACECode not running — OK
			}
		}
	});

	it("runs full health check and returns pass", async () => {
		const result = await runHealthCheck(false);

		expect(result.report.result).toBe("pass");
		expect(result.report.leds.left).toBe("ok");
		expect(result.report.leds.right).toBe("ok");
		expect(result.report.buzzer).toBe("ok");
		expect(result.report.motors.fl).toBe("ok");
		expect(result.report.ultrasonic.distance_cm).not.toBeNull();
		expect(result.report.tracking.left).not.toBeNull();
		expect(result.flashed).toBe(true);
	}, 120_000); // 2 min timeout for compile + flash + serial

	it("reads serial with skipFlash after flash", async () => {
		// health_check.ino was flashed by previous test
		const result = await runHealthCheck(true);

		expect(result.flashed).toBe(false);
		// Result may vary since the firmware runs setup() only once
		// On reset/power cycle, it will re-emit
	}, 30_000);
});
