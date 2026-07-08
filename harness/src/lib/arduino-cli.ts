/**
 * arduino-cli wrapper for compiling sketches.
 *
 * Uses FQBN esp32:esp32:esp32 and a temp build path.
 *
 * Lifecycle contract (design AD4, AD5, REQ-002):
 * - The wrapper owns the complete lifecycle of the process it creates.
 * - Exactly one abort listener is installed and removed on every terminal path.
 * - The wrapper does NOT resolve or reject normally before `close`.
 * - On abort, calls `terminateChild(proc)`: rejects with `ChildTerminationError`
 *   if termination is unconfirmed, otherwise rejects with an `AbortError`.
 * - `close`, `error`, and abort share a single settle-once guard.
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
	ChildTerminationError,
	type TerminateChildResult,
	terminateChild,
} from "./child-process.js";
import { FQBN } from "./constants.js";

export interface CompileOptions {
	sketchPath: string;
	buildPath: string;
	signal?: AbortSignal;
	onUpdate?: (progress: string) => void;
}

export interface CompileResult {
	success: boolean;
	stdout: string;
	stderr: string;
	buildPath: string;
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
 * Compile an Arduino sketch using arduino-cli.
 *
 * @returns CompileResult with success status and output
 */
export function compileSketch(opts: CompileOptions): Promise<CompileResult> {
	const { sketchPath, buildPath, signal, onUpdate } = opts;

	const args = ["compile", "--fqbn", FQBN, "--build-path", buildPath, sketchPath];

	const proc = spawn("arduino-cli", args, {
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

	return settleWrapper<CompileResult>(
		proc,
		signal,
		(code) => ({
			success: code === 0,
			stdout,
			stderr,
			buildPath,
		}),
		(err) => ({
			success: false,
			stdout,
			stderr: `${stderr}\nSpawn error: ${err.message}`,
			buildPath,
		}),
	);
}

/**
 * Shared settle-once controller for child-process wrappers (design AD5).
 *
 * - Installs exactly one abort listener; removes it on every terminal path.
 * - On abort, calls `terminateChild(proc)`; rejects with `ChildTerminationError`
 *   if termination is unconfirmed, otherwise `AbortError`.
 * - `close`, `error`, and abort share a single settle-once guard.
 * - No unhandled rejection originates from the abort listener.
 * - If abort has begun, a `close` produced by termination is NOT successful.
 */
export function settleWrapper<T>(
	proc: ChildProcess,
	signal: AbortSignal | undefined,
	onClose: (code: number | null) => T,
	onError: (err: Error) => T,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;

		const finish = (action: () => void): void => {
			if (settled) return;
			settled = true;
			removeAbortListener();
			try {
				action();
			} catch (error) {
				// Any throw inside the settlement path is routed through reject,
				// never as an unhandled rejection.
				reject(error);
			}
		};

		const handleAbort = (): void => {
			// Abort listener: start an observed async task and report its
			// outcome through finish(). Must not throw outside the promise.
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
								`Compile child process termination could not be confirmed: ${termination.error}`,
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

		// Close handler — normal settlement (success or failure by exit code).
		// If abort has begun, this close was produced by termination and must
		// NOT be treated as successful completion. The settle-once guard
		// ensures the abort path wins if it fired first.
		proc.on("close", (code) => {
			finish(() => {
				if (signal?.aborted) {
					// Abort already selected — do not treat close as success.
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

		// Abort listener setup.
		if (signal) {
			if (signal.aborted) {
				// Already aborted before we could attach — terminate now.
				handleAbort();
				return;
			}
			onAbort = handleAbort;
			signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}
