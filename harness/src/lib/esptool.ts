/**
 * esptool wrapper — flashes compiled firmware to the ESP32.
 *
 * Hardcoded invariants (ADR-005):
 * - Baud ALWAYS 115200 (never overridable)
 * - Uses bundled esptool path (never arduino-cli upload)
 * - Fixed flash offsets
 *
 * Includes RISK-04 mitigation: esptool path existence check.
 */

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { attachAbort } from "./abort.js";
import { BAUD, ESPTOOL_PATH, FLASH_OFFSETS } from "./constants.js";

export interface FlashOptions {
	buildPath: string;
	/** Sketch name (without .ino extension) for locating bin files. */
	sketchName: string;
	port: string;
	signal?: AbortSignal;
	onUpdate?: (progress: string) => void;
}

export interface FlashResult {
	success: boolean;
	stdout: string;
	stderr: string;
}

export class EsptoolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EsptoolError";
	}
}

/**
 * Verify the bundled esptool binary exists at the expected path.
 * RISK-04 mitigation.
 */
export async function checkEsptoolAvailable(): Promise<boolean> {
	try {
		await access(ESPTOOL_PATH);
		return true;
	} catch {
		return false;
	}
}

/**
 * Flash firmware to the ESP32 using the bundled esptool.
 *
 * @throws {EsptoolError} if esptool binary not found
 */
export async function flashSketch(opts: FlashOptions): Promise<FlashResult> {
	const available = await checkEsptoolAvailable();
	if (!available) {
		throw new EsptoolError(`esptool not found at ${ESPTOOL_PATH}. Ensure ACECode is installed.`);
	}

	return new Promise((resolve) => {
		const { buildPath, sketchName, port, signal, onUpdate } = opts;

		// Build bin file paths from the build output directory
		const bootloaderBin = join(buildPath, `${sketchName}.ino.bootloader.bin`);
		const partitionsBin = join(buildPath, `${sketchName}.ino.partitions.bin`);
		const bootApp0Bin = join(buildPath, "boot_app0.bin");
		const firmwareBin = join(buildPath, `${sketchName}.ino.bin`);

		const args = [
			"--chip",
			"esp32",
			"--port",
			port,
			"--baud",
			String(BAUD), // ALWAYS 115200 — hardcoded, not configurable
			"--before",
			"default_reset",
			"--after",
			"hard_reset",
			"write_flash",
			"-z",
			"--flash_mode",
			"dio",
			"--flash_freq",
			"80m",
			"--flash_size",
			"detect",
			String(FLASH_OFFSETS.bootloader),
			bootloaderBin,
			String(FLASH_OFFSETS.partitions),
			partitionsBin,
			String(FLASH_OFFSETS.boot_app0),
			bootApp0Bin,
			String(FLASH_OFFSETS.firmware),
			firmwareBin,
		];

		const proc = spawn(ESPTOOL_PATH, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		proc.stdout?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stdout += text;
			onUpdate?.(text.trim().split("\n").pop() ?? "");
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		const cleanup = attachAbort(signal, proc);

		proc.on("error", (err) => {
			cleanup();
			resolve({
				success: false,
				stdout,
				stderr: `${stderr}\nSpawn error: ${err.message}`,
			});
		});

		proc.on("close", (code) => {
			cleanup();
			resolve({
				success: code === 0,
				stdout,
				stderr,
			});
		});
	});
}
