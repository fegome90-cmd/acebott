/**
 * Serial monitor via pyserial with line buffering, timeout, and
 * cancellation support.
 *
 * Decision (OQ-2 from design): Poll for first JSON line, with hard
 * timeout of 10s. No fixed delay.
 */

import { type ChildProcess, spawn } from "node:child_process";
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
 * Read serial output from the specified port using pyserial.
 *
 * @returns Collected lines matching the predicate. Empty array on timeout.
 */
export function readSerial(opts: SerialReadOptions): Promise<string[]> {
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
		let resolved = false;
		let timeoutHandle: NodeJS.Timeout | undefined;
		let proc: ChildProcess | undefined;
		let detachAbort: (() => void) | undefined;

		const finish = (result: string[]) => {
			if (resolved) return;
			resolved = true;
			if (timeoutHandle) clearTimeout(timeoutHandle);
			if (detachAbort) detachAbort();
			if (proc && !proc.killed) {
				proc.kill("SIGTERM");
			}
			resolve(result);
		};

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

		// Timeout
		timeoutHandle = setTimeout(() => {
			finish(collected);
		}, timeoutMs + 2000); // extra 2s buffer for process spawn overhead

		// Abort signal — when aborted, finish() resolves immediately AND
		// cleans up the listener to avoid leaks on long-lived signals.
		if (signal) {
			if (signal.aborted) {
				finish(collected);
				return;
			}
			const onAbort = () => finish(collected);
			signal.addEventListener("abort", onAbort, { once: true });
			detachAbort = () => signal.removeEventListener("abort", onAbort);
		}

		proc.stdout?.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed && linePredicate(trimmed)) {
					collected.push(trimmed);
					if (stopPredicate(trimmed)) {
						finish(collected);
						return;
					}
				}
			}
		});

		proc.on("error", () => {
			finish(collected);
		});

		proc.on("close", () => {
			finish(collected);
		});
	});
}
