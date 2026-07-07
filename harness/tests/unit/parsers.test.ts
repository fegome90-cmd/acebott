/**
 * Unit tests for the JSON-lines parser.
 * All tests are hardware-free (pure function testing).
 */

import { describe, expect, it } from "vitest";
import type { HealthReport } from "../../src/lib/parser.js";
import { createDefaultReport, isHealthLine, parseHealthLines } from "../../src/lib/parser.js";

describe("createDefaultReport", () => {
	it("returns a report with all fields defaulted to unknown/null", () => {
		const report = createDefaultReport();
		expect(report.result).toBe("timeout");
		expect(report.leds.left).toBe("unknown");
		expect(report.motors.tested).toBe("init_only");
		expect(report.ultrasonic.distance_cm).toBeNull();
	});
});

describe("isHealthLine", () => {
	it("returns true for a health line", () => {
		expect(isHealthLine('{"t":"health","result":"pass"}')).toBe(true);
	});

	it("returns false for non-health lines", () => {
		expect(isHealthLine('{"t":"leds","left":"ok"}')).toBe(false);
		expect(isHealthLine("garbage")).toBe(false);
	});
});

describe("parseHealthLines", () => {
	it("parses a complete valid health report", () => {
		const lines = [
			'{"t":"motors","fl":"ok","fr":"ok","bl":"ok","br":"ok"}',
			'{"t":"leds","left":"ok","right":"ok"}',
			'{"t":"buzzer","status":"ok"}',
			'{"t":"ultrasonic","distance_cm":42}',
			'{"t":"tracking","left":1200,"middle":800,"right":2100}',
			'{"t":"ir","code":"none"}',
			'{"t":"health","result":"pass"}',
		];

		const report = parseHealthLines(lines);

		expect(report.motors.fl).toBe("ok");
		expect(report.motors.fr).toBe("ok");
		expect(report.leds.left).toBe("ok");
		expect(report.leds.right).toBe("ok");
		expect(report.buzzer).toBe("ok");
		expect(report.ultrasonic.distance_cm).toBe(42);
		expect(report.tracking.left).toBe(1200);
		expect(report.tracking.middle).toBe(800);
		expect(report.tracking.right).toBe(2100);
		expect(report.ir.code).toBe("none");
		expect(report.result).toBe("pass");
	});

	it("skips malformed JSON lines without failing", () => {
		const lines = [
			"this is not json",
			'{"t":"leds","left":"ok","right":"ok"}',
			"{broken",
			'{"t":"buzzer","status":"ok"}',
			'{"t":"health","result":"pass"}',
		];

		const report = parseHealthLines(lines);

		expect(report.leds.left).toBe("ok");
		expect(report.buzzer).toBe("ok");
		expect(report.result).toBe("pass");
	});

	it("returns timeout when no health line is present", () => {
		const lines = ['{"t":"leds","left":"ok","right":"ok"}'];

		const report = parseHealthLines(lines);
		expect(report.result).toBe("timeout");
	});

	it("returns timeout for empty input", () => {
		const report = parseHealthLines([]);
		expect(report.result).toBe("timeout");
	});

	it("handles fail result", () => {
		const lines = ['{"t":"health","result":"fail"}'];

		const report = parseHealthLines(lines);
		expect(report.result).toBe("fail");
	});

	it("handles IR hex code", () => {
		const lines = ['{"t":"ir","code":"b946ff00"}'];

		const report = parseHealthLines(lines);
		expect(report.ir.code).toBe("b946ff00");
	});

	it("handles partial reports (only some lines present)", () => {
		const lines = ['{"t":"ultrasonic","distance_cm":150}', '{"t":"health","result":"pass"}'];

		const report = parseHealthLines(lines);
		expect(report.ultrasonic.distance_cm).toBe(150);
		expect(report.result).toBe("pass");
		expect(report.leds.left).toBe("unknown");
		expect(report.motors.fl).toBe("unknown");
	});
});
