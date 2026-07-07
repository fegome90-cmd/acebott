/**
 * JSON-lines parser for health_check firmware output.
 *
 * Parses lines like: {"t":"leds","left":"ok","right":"ok"}
 * into a structured HealthReport. Skips malformed lines (REQ-003).
 */

export interface HealthReport {
	leds: { left: string; right: string };
	buzzer: string;
	motors: { fl: string; fr: string; bl: string; br: string; tested: string };
	ultrasonic: { distance_cm: number | null };
	tracking: {
		left: number | null;
		middle: number | null;
		right: number | null;
	};
	ir: { code: string };
	result: "pass" | "fail" | "timeout";
}

interface JsonLine {
	t?: string;
	[key: string]: unknown;
}

/**
 * Create an empty/default HealthReport.
 */
export function createDefaultReport(): HealthReport {
	return {
		leds: { left: "unknown", right: "unknown" },
		buzzer: "unknown",
		motors: {
			fl: "unknown",
			fr: "unknown",
			bl: "unknown",
			br: "unknown",
			tested: "init_only",
		},
		ultrasonic: { distance_cm: null },
		tracking: { left: null, middle: null, right: null },
		ir: { code: "none" },
		result: "timeout",
	};
}

/**
 * Check if a line is the terminal health line.
 */
export function isHealthLine(line: string): boolean {
	return line.includes('"health"');
}

/**
 * Parse serial lines into a HealthReport.
 *
 * - Lines are JSON-parsed individually
 * - Malformed lines are skipped (not fatal)
 * - "health" line sets the final result
 */
export function parseHealthLines(lines: string[]): HealthReport {
	const report = createDefaultReport();

	for (const line of lines) {
		let parsed: JsonLine;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue; // skip malformed lines
		}

		switch (parsed.t) {
			case "leds":
				if (typeof parsed.left === "string") report.leds.left = parsed.left;
				if (typeof parsed.right === "string") report.leds.right = parsed.right;
				break;
			case "buzzer":
				if (typeof parsed.status === "string") report.buzzer = parsed.status;
				break;
			case "motors":
				for (const key of ["fl", "fr", "bl", "br"] as const) {
					if (typeof parsed[key] === "string") {
						report.motors[key] = parsed[key] as string;
					}
				}
				break;
			case "ultrasonic":
				if (typeof parsed.distance_cm === "number") {
					report.ultrasonic.distance_cm = parsed.distance_cm;
				}
				break;
			case "tracking":
				for (const key of ["left", "middle", "right"] as const) {
					if (typeof parsed[key] === "number") {
						report.tracking[key] = parsed[key] as number;
					}
				}
				break;
			case "ir":
				if (typeof parsed.code === "string") report.ir.code = parsed.code;
				break;
			case "health":
				if (parsed.result === "pass" || parsed.result === "fail") {
					report.result = parsed.result;
				}
				break;
		}
	}

	return report;
}
