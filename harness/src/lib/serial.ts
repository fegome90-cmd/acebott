/**
 * Serial monitor via pyserial with line buffering, timeout, and
 * cancellation support.
 *
 * Decision (OQ-2 from design): Poll for first JSON line, with hard
 * timeout of 10s. No fixed delay.
 *
 * Lifecycle contract (design AD7, AD8, REQ-004):
 * - `readSerial` separates result selection from promise resolution.
 * - `selectResult` picks a terminal `SerialReadResult` exactly once.
 * - `finalize` clears listeners/timer, calls `terminateChild`, and
 *   converts any termination failure into `status: "error"` regardless of
 *   the previously selected serial state.
 * - Resolves only after termination handling finishes.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { terminateChild } from "./child-process.js";
import { SERIAL_TIMEOUT_MS } from "./constants.js";
import { validatePort } from "./validate.js";

export interface SerialReadOptions {
	port: string;
	baud: number;
	timeoutMs?: number;
	signal?: AbortSignal;
	/** Lines matching this predicate are collected. Default: starts with "{" */
	linePredicate?: (line: string) => boolean;
	/** Stop when a line matches this. Default: line containing "health" */
	stopPredicate?: (line: string) => boolean;
}

/**
 * Discriminated serial read result (design AD7, REQ-004).
 *
 * Terminal meanings:
 * - `success`: stop predicate was reached.
 * - `incomplete`: process closed with code 0 before the stop predicate.
 * - `timeout`: timeout selected before abort or process closure.
 * - `error`: spawn failure, non-zero exit, unexpected signal, pipe failure,
 *   or unconfirmed child termination.
 * - `cancelled`: abort was selected and child termination was confirmed.
 *
 * Breaking change: `readSerial` previously returned `Promise<string[]>`.
 */
export type SerialReadResult =
	| {
			status: "success";
			data: string[];
	  }
	| {
			status: "incomplete";
			data: string[];
			exitCode: 0;
	  }
	| {
			status: "timeout";
			data: string[];
	  }
	| {
			status: "error";
			data: string[];
			error: string;
			code?: "child_termination_unconfirmed" | "process_failed";
			processMayStillBeRunning?: boolean;
			stderr?: string;
			exitCode?: number | null;
			signal?: NodeJS.Signals | null;
	  }
	| {
			status: "cancelled";
			data: string[];
	  };

/**
 * Read serial output from the specified port using pyserial.
 *
 * @returns Discriminated `SerialReadResult`. Never resolves until child
 *   termination handling has completed.
 *
 * Breaking change: previously returned `Promise<string[]>`.
 */
export function readSerial(opts: SerialReadOptions): Promise<SerialReadResult> {
	return new Promise((resolve) => {
		const {
			port,
			baud,
			timeoutMs = SERIAL_TIMEOUT_MS,
			signal,
			linePredicate = (line: string) => line.trim().startsWith("{"),
			stopPredicate = (line: string) => line.includes('"health"'),
		} = opts;

		const collected: string[] = [];
		let buffer = "";
		let stderrText = "";
		let selected = false;
		let timeoutHandle: NodeJS.Timeout | undefined;
		let proc: ChildProcess | undefined;
		let detachAbort: (() => void) | undefined;

		/**
		 * Select a terminal serial result exactly once (design AD8).
		 * If abort has already occurred, overrides to `cancelled`.
		 * Then runs finalize asynchronously.
		 */
		const selectResult = (result: SerialReadResult): void => {
			if (selected) return;
			selected = true;

			const selectedResult: SerialReadResult = signal?.aborted
				? { status: "cancelled", data: [...collected] }
				: result;

			void finalize(selectedResult);
		};

		/**
		 * Build the `child_termination_unconfirmed` error result used when
		 * terminateChild throws or returns `failed`. Only the `error` string
		 * differs between the two branches.
		 */
		const terminationErrorResult = (data: string[], error: string): SerialReadResult => ({
			status: "error",
			data,
			error,
			code: "child_termination_unconfirmed",
			processMayStillBeRunning: true,
		});

		/**
		 * Clear runtime listeners and timer, call terminateChild, and resolve.
		 * Any termination failure overrides the selected result with `error`.
		 * Never throws — routes all errors into an `error` result.
		 */
		const finalize = async (result: SerialReadResult): Promise<void> => {
			clearRuntimeListenersAndTimer();

			// No process was spawned (e.g. pre-aborted signal) — resolve directly
			// without invoking terminateChild. There is nothing to terminate.
			if (!proc) {
				resolve(result);
				return;
			}

			let termination: Awaited<ReturnType<typeof terminateChild>>;
			try {
				termination = await terminateChild(proc);
			} catch (err) {
				// terminateChild is contract-bound not to throw, but defend.
				resolve(
					terminationErrorResult(
						result.data,
						`Serial child process termination threw: ${
							err instanceof Error ? err.message : String(err)
						}`,
					),
				);
				return;
			}

			if (termination.status === "failed") {
				resolve(
					terminationErrorResult(
						result.data,
						"Serial child process termination could not be confirmed",
					),
				);
				return;
			}

			resolve(result);
		};

		/**
		 * Remove the close/error listeners, stdout/stderr data listeners,
		 * clear the timeout, and detach the abort listener.
		 */
		const clearRuntimeListenersAndTimer = (): void => {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
				timeoutHandle = undefined;
			}
			if (detachAbort) {
				detachAbort();
				detachAbort = undefined;
			}
			if (proc) {
				proc.removeAllListeners("close");
				proc.removeAllListeners("error");
				proc.stdout?.removeAllListeners("data");
				proc.stderr?.removeAllListeners("data");
			}
		};

		// Abort signal — if already aborted, select cancelled immediately.
		if (signal) {
			if (signal.aborted) {
				selectResult({ status: "cancelled", data: [] });
				return;
			}
			const onAbort = () => {
				selectResult({ status: "cancelled", data: [...collected] });
			};
			signal.addEventListener("abort", onAbort, { once: true });
			detachAbort = () => signal.removeEventListener("abort", onAbort);
		}

		// Python script that reads serial and prints lines to stdout
		// Security: validatePort() prevents command injection via port.
		const safePort = validatePort(port);
		const timeoutSec = Math.ceil(timeoutMs / 1000);
		const pyScript = [
			"import serial,sys,time",
			`s=serial.Serial('${safePort}',${baud},timeout=1)`,
			"start=time.time()",
			`while time.time()-start<${timeoutSec}:`,
			"  line=s.readline().decode(errors='replace').strip()",
			"  if line: print(line,flush=True)",
			"s.close()",
		].join(";");

		proc = spawn("uv", ["run", "--with", "pyserial", "python3", "-c", pyScript], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Timeout — select timeout result. Extra 2s buffer for spawn overhead.
		timeoutHandle = setTimeout(() => {
			selectResult({ status: "timeout", data: [...collected] });
		}, timeoutMs + 2000);

		proc.stdout?.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed && linePredicate(trimmed)) {
					collected.push(trimmed);
					if (stopPredicate(trimmed)) {
						selectResult({ status: "success", data: [...collected] });
						return;
					}
				}
			}
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			stderrText += chunk.toString();
		});

		proc.on("error", (err: Error) => {
			selectResult({
				status: "error",
				data: [...collected],
				error: err.message,
				code: "process_failed",
				stderr: stderrText,
			});
		});

		proc.on("close", (code: number | null, exitSignal: NodeJS.Signals | null) => {
			if (code === 0) {
				selectResult({
					status: "incomplete",
					data: [...collected],
					exitCode: 0,
				});
			} else {
				// Distinguish signal termination (code === null) from non-zero
				// exit — "exited with code null" is opaque when debugging why a
				// process died. Name the signal explicitly when one is present.
				const error =
					exitSignal !== null
						? `Serial process terminated by signal ${exitSignal}`
						: `Serial process exited with code ${code}`;
				selectResult({
					status: "error",
					data: [...collected],
					error,
					code: "process_failed",
					stderr: stderrText,
					exitCode: code,
					signal: exitSignal,
				});
			}
		});
	});
}
