/**
 * esptool wrapper — flashes compiled firmware to the ESP32.
 *
 * Hardcoded invariants (ADR-005):
 * - Baud ALWAYS 115200 (never overridable)
 * - Uses bundled esptool path (never arduino-cli upload)
 * - Fixed flash offsets
 *
 * Includes RISK-04 mitigation: esptool path existence check.
 *
 * Lifecycle contract (design AD4, AD5, REQ-002):
 * - Same settle-once, termination-aware contract as compileSketch.
 * - On abort, rejects with `ChildTerminationError` if termination unconfirmed,
 *   otherwise `AbortError`.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	ChildTerminationError,
	type TerminateChildResult,
	terminateChild,
} from "./child-process.js";
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
 * Create an AbortError-compatible error (DOMException not available in all envs).
 */
function createAbortError(): Error {
	const err = new Error("The operation was aborted");
	err.name = "AbortError";
	return err;
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
 * Required flash artifacts and their human-readable names (design AD15, REQ-010).
 */
interface ArtifactSpec {
	readonly label: string;
	readonly path: string;
}

/**
 * Build the list of required flash artifacts from build path + sketch name.
 */
function requiredArtifacts(buildPath: string, sketchName: string): ArtifactSpec[] {
	return [
		{ label: "bootloader", path: join(buildPath, `${sketchName}.ino.bootloader.bin`) },
		{ label: "partition table", path: join(buildPath, `${sketchName}.ino.partitions.bin`) },
		{ label: "boot_app0", path: join(buildPath, "boot_app0.bin") },
		{ label: "application firmware", path: join(buildPath, `${sketchName}.ino.bin`) },
	];
}

/**
 * Validate that all four required flash artifacts exist, are regular files,
 * and have non-zero size. Raises an artifact-specific `EsptoolError` before
 * any esptool process is created (design AD15, REQ-010).
 *
 * Caller-owned files are never deleted or modified by validation.
 */
async function validateFlashArtifacts(buildPath: string, sketchName: string): Promise<void> {
	for (const artifact of requiredArtifacts(buildPath, sketchName)) {
		const stats = await stat(artifact.path).catch((error: NodeJS.ErrnoException) => {
			// Preserve the original error code so callers can distinguish
			// "missing" (ENOENT) from "permission denied" (EACCES) from "I/O
			// error" (EIO). Collapsing all to "not found" misdirects debugging.
			const code = error?.code ?? "UNKNOWN";
			throw new EsptoolError(
				`Required flash artifact ${artifact.label} could not be accessed (${code}): ${artifact.path}`,
			);
		});
		if (!stats.isFile()) {
			throw new EsptoolError(
				`Required flash artifact ${artifact.label} is not a regular file: ${artifact.path}`,
			);
		}
		if (stats.size <= 0) {
			throw new EsptoolError(
				`Required flash artifact ${artifact.label} is empty (0 bytes): ${artifact.path}`,
			);
		}
	}
}

/**
 * Flash firmware to the ESP32 using the bundled esptool.
 *
 * @throws {EsptoolError} if esptool binary not found or any flash artifact
 *   is missing, empty, or not a regular file (REQ-010).
 */
export async function flashSketch(opts: FlashOptions): Promise<FlashResult> {
	const available = await checkEsptoolAvailable();
	if (!available) {
		throw new EsptoolError(`esptool not found at ${ESPTOOL_PATH}. Ensure ACECode is installed.`);
	}

	// Validate artifacts BEFORE spawning esptool (REQ-010, AD15).
	await validateFlashArtifacts(opts.buildPath, opts.sketchName);

	const { port, signal, onUpdate } = opts;

	// Derive flash paths from the SAME validated source (requiredArtifacts) so
	// validation and flashing cannot drift apart. Order matches FLASH_OFFSETS.
	const [bootloader, partitions, bootApp0, firmware] = requiredArtifacts(
		opts.buildPath,
		opts.sketchName,
	);
	const bootloaderBin = bootloader.path;
	const partitionsBin = partitions.path;
	const bootApp0Bin = bootApp0.path;
	const firmwareBin = firmware.path;

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

	return settleFlashWrapper(
		proc,
		signal,
		(code) => ({
			success: code === 0,
			stdout,
			stderr,
		}),
		(err) => ({
			success: false,
			stdout,
			stderr: `${stderr}\nSpawn error: ${err.message}`,
		}),
	);
}

/**
 * Settle-once controller for esptool (same contract as compile's settleWrapper).
 * Duplicated here to keep esptool.ts self-contained per the original module
 * boundary; the lifecycle contract is identical (design AD4, AD5).
 */
function settleFlashWrapper(
	proc: ChildProcess,
	signal: AbortSignal | undefined,
	onClose: (code: number | null) => FlashResult,
	onError: (err: Error) => FlashResult,
): Promise<FlashResult> {
	return new Promise<FlashResult>((resolve, reject) => {
		let settled = false;

		const finish = (action: () => void): void => {
			if (settled) return;
			settled = true;
			removeAbortListener();
			try {
				action();
			} catch (error) {
				reject(error);
			}
		};

		const handleAbort = (): void => {
			void (async () => {
				let termination: TerminateChildResult;
				try {
					termination = await terminateChild(proc);
				} catch (error) {
					// terminateChild must not throw, but if it ever does, route
					// the error through the wrapper promise (never unhandled).
					finish(() => reject(error));
					return;
				}
				finish(() => {
					if (termination.status === "failed") {
						reject(
							new ChildTerminationError(
								`esptool child process termination could not be confirmed: ${termination.error}`,
								termination,
							),
						);
					} else {
						reject(createAbortError());
					}
				});
			})();
		};

		const removeAbortListener = (): void => {
			if (signal && onAbort) {
				signal.removeEventListener("abort", onAbort);
			}
		};

		let onAbort: (() => void) | undefined;

		proc.on("close", (code) => {
			finish(() => {
				if (signal?.aborted) {
					reject(createAbortError());
					return;
				}
				resolve(onClose(code));
			});
		});

		proc.on("error", (err) => {
			finish(() => {
				if (signal?.aborted) {
					reject(createAbortError());
					return;
				}
				resolve(onError(err));
			});
		});

		if (signal) {
			if (signal.aborted) {
				handleAbort();
				return;
			}
			onAbort = handleAbort;
			signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}
