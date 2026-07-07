/**
 * robot_detect tool — detects the connected Acebott QD001.
 *
 * Returns structured info: port, chip, ACECode state, port busy.
 * Read-only — no hardware side effects.
 */

import { exec } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ESPTOOL_PATH } from "../lib/constants.js";
import { type ChipInfo, detectChip } from "../lib/usb.js";
import { isValidPort } from "../lib/validate.js";

const execAsync = promisify(exec);

export interface DetectResult {
	connected: boolean;
	port: string | null;
	chip: ChipInfo | null;
	acecodeRunning: boolean;
	portBusy: boolean;
	esptoolAvailable: boolean;
	firmwareHint: string;
}

/**
 * Core detection logic — callable from other tools (no Pi context needed).
 */
export async function detectRobot(portOverride?: string): Promise<DetectResult> {
	const port = portOverride ?? (await findSerialPort());
	const chip = await detectChip();
	const acecodeRunning = await isAceCodeRunning();
	const portBusy = port ? await isPortBusy(port) : false;
	const esptoolAvailable = await isEsptoolAvailable();

	return {
		connected: port !== null,
		port,
		chip,
		acecodeRunning,
		portBusy,
		esptoolAvailable,
		firmwareHint: "unknown",
	};
}

async function findSerialPort(): Promise<string | null> {
	try {
		const entries = await readdir("/dev/");
		const ports = entries.filter((e) => e.startsWith("cu.usbserial")).map((e) => `/dev/${e}`);
		return ports.length > 0 ? ports[0] : null;
	} catch {
		return null;
	}
}

async function isAceCodeRunning(): Promise<boolean> {
	try {
		const { stdout } = await execAsync("pgrep -f ACECode", { timeout: 3000 });
		return stdout.trim().length > 0;
	} catch {
		return false;
	}
}

async function isPortBusy(port: string): Promise<boolean> {
	if (!isValidPort(port)) return false;
	try {
		const { stdout } = await execAsync(`lsof ${port}`, { timeout: 3000 });
		return stdout.trim().length > 0;
	} catch {
		return false; // lsof returns non-zero when port is free
	}
}

async function isEsptoolAvailable(): Promise<boolean> {
	try {
		await access(ESPTOOL_PATH);
		return true;
	} catch {
		return false;
	}
}

/**
 * Register the robot_detect tool.
 */
export function registerDetectTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "robot_detect",
		label: "Detect Robot",
		description: `Detect the connected Acebott QD001 robot.

Returns: port path, USB chip identification (CH340), whether ACECode is
running, whether the port is busy, and whether the bundled esptool is
available. This tool is read-only — it does NOT flash or modify the robot.

## When to Use
- Before any flash or health check operation
- When the user asks "is the robot connected?"
- Before calling robot_health`,
		promptGuidelines: [
			"Use robot_detect before any hardware operation to confirm the robot is connected and the port is free.",
		],
		parameters: Type.Object({
			port: Type.Optional(
				Type.String({
					description:
						"Specific port to check (e.g. /dev/cu.usbserial-110). Auto-detects if omitted.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Cancelled" }],
					details: { cancelled: true },
				};
			}

			try {
				const result = await detectRobot(params.port);

				if (!result.connected) {
					return {
						content: [
							{
								type: "text",
								text: "No Acebott detected. No USB-serial device found at /dev/cu.usbserial-*.",
							},
						],
						details: result as unknown as Record<string, unknown>,
					};
				}

				const warnings: string[] = [];
				if (result.acecodeRunning) {
					warnings.push(
						"WARNING: ACECode is running — kill it before flashing (pkill -9 -f ACECode).",
					);
				}
				if (result.portBusy) {
					warnings.push("WARNING: Port is busy — another process holds it.");
				}
				if (!result.esptoolAvailable) {
					warnings.push(
						"WARNING: esptool not found at expected path — ACECode may not be installed.",
					);
				}

				const summary = [
					`Robot: connected at ${result.port}`,
					`Chip: ${result.chip?.vendor ?? "unknown"} (${result.chip?.vendorId ?? "?"}:${result.chip?.productId ?? "?"})`,
					`ACECode running: ${result.acecodeRunning}`,
					`Port busy: ${result.portBusy}`,
					`esptool available: ${result.esptoolAvailable}`,
					...warnings,
				].join("\n");

				return {
					content: [{ type: "text", text: summary }],
					details: result,
				};
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Error: ${msg}` }],
					details: { error: msg } as unknown as Record<string, unknown>,
				};
			}
		},
	});
}
