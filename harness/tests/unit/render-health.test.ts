import { describe, expect, it } from "vitest";
import type { HealthCheckResult } from "../../src/tools/health.js";
import { renderHealthResult } from "../../src/tools/health.js";

// Minimal valid HealthCheckContext for all variants.
const ctx = {
	stage: "complete" as const,
	detect: undefined,
	flashed: false,
};

// Minimal valid HealthReport for protocol_complete.
// NOTE: HealthReport (src/lib/parser.ts) uses `string` for all status fields,
// `number | null` for tracking values, and `number | null` for distance. Do NOT
// use booleans — match the interface exactly or tsc will reject this.
const report = {
	leds: { left: "ok", right: "ok" },
	buzzer: "ok",
	motors: { tested: "4", fl: "ok", fr: "ok", bl: "ok", br: "ok" },
	ultrasonic: { distance_cm: 25 },
	tracking: { left: 1, middle: 0, right: 1 },
	ir: { code: "0x10" },
	result: "pass" as const,
};

describe("renderHealthResult — neutral semantics (REQ-011)", () => {
	it("protocol_complete renders 'Protocol complete', never 'healthy' or 'passed'", () => {
		const result: HealthCheckResult = {
			...ctx,
			status: "protocol_complete",
			report,
		};
		const rendered = renderHealthResult(result);
		const text = rendered.content[0].text;

		expect(text).toContain("Protocol complete");
		// Forbidden diagnostic language — must never appear for protocol_complete.
		expect(text).not.toMatch(/healthy/i);
		expect(text).not.toMatch(/passed/i);
		expect(text).not.toMatch(/all components working/i);
		expect(text).not.toMatch(/diagnosis successful/i);
	});

	it("error with child_termination_unconfirmed warns about preserved artifacts", () => {
		const result: HealthCheckResult = {
			stage: "compile",
			detect: undefined,
			flashed: false,
			status: "error",
			error: "compile child termination unconfirmed",
			code: "child_termination_unconfirmed",
			processMayStillBeRunning: true,
			cleanupSkipped: true,
			artifactsPreservedAt: "/tmp/build-xyz",
			partialData: [],
		};
		const rendered = renderHealthResult(result);
		const text = rendered.content[0].text;

		expect(text).toContain("process may still be running");
		expect(text).toContain("/tmp/build-xyz");
	});

	it("cancelled renders 'Cancelled'", () => {
		const result: HealthCheckResult = {
			stage: "serial",
			detect: undefined,
			flashed: true,
			status: "cancelled",
			partialData: [],
		};
		const rendered = renderHealthResult(result);
		expect(rendered.content[0].text).toBe("Cancelled");
	});

	it("timeout renders timeout message with line count", () => {
		const result: HealthCheckResult = {
			stage: "serial",
			detect: undefined,
			flashed: true,
			status: "timeout",
			partialData: ["line1", "line2"],
		};
		const rendered = renderHealthResult(result);
		expect(rendered.content[0].text).toContain("timed out");
		expect(rendered.content[0].text).toContain("2 line(s)");
	});

	it("incomplete renders exit code and line count", () => {
		const result: HealthCheckResult = {
			stage: "serial",
			detect: undefined,
			flashed: true,
			status: "incomplete",
			partialData: ["line1"],
			exitCode: 0,
		};
		const rendered = renderHealthResult(result);
		expect(rendered.content[0].text).toContain("incomplete");
		expect(rendered.content[0].text).toContain("code 0");
	});
});
