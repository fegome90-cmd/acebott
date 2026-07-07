/**
 * Shared child-process lifecycle primitives.
 *
 * Race-safe `waitForClose` and non-throwing `terminateChild`. Every wrapper
 * that creates a ChildProcess MUST route termination through `terminateChild`
 * so that a failed termination is reported explicitly instead of being hidden
 * as an ordinary cancellation.
 *
 * Critical invariants (design AD1–AD3, AD6):
 * - `terminateChild` MUST NOT throw — it always returns `TerminateChildResult`.
 * - `waitForClose` MUST prevent the "closed between check and listener" race.
 * - `ChildTerminationError` has PRIORITY over ordinary cancellation.
 */

import type { ChildProcess } from "node:child_process";

/**
 * Discriminated result of attempting to terminate a child process.
 *
 * - `already_closed`: process had already exited before termination ran.
 * - `terminated`: SIGTERM closed the process within the grace period.
 * - `killed`: SIGKILL closed the process after SIGTERM was insufficient.
 * - `failed`: closure could not be confirmed (process may still be running).
 */
export type TerminateChildResult =
	| { status: "already_closed" }
	| { status: "terminated"; signal: "SIGTERM" }
	| { status: "killed"; signal: "SIGKILL" }
	| { status: "failed"; error: string };

/**
 * Error raised when a child process could not be confirmed terminated.
 *
 * Has PRIORITY over ordinary cancellation: a failed termination means the
 * process may still be running, so the caller MUST NOT treat the result as
 * a clean cancellation and MUST preserve build artifacts.
 */
export class ChildTerminationError extends Error {
	readonly processMayStillBeRunning = true;

	constructor(
		message: string,
		readonly termination: TerminateChildResult,
	) {
		super(message);
		this.name = "ChildTerminationError";
	}
}

/**
 * Wait for a child process to emit `close`, race-safe against the
 * "closed between check and listener registration" window.
 *
 * Contract (design AD2):
 * 1. Check `exitCode` and `signalCode`.
 * 2. Register a one-shot `close` listener.
 * 3. Re-check `exitCode` and `signalCode`.
 * 4. Start a timeout only after the listener is registered.
 * 5. Remove the listener and clear the timer on every terminal path.
 *
 * @returns `true` if closure was confirmed, `false` if the timeout expired.
 */
export async function waitForClose(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
	// 1. Initial check — already closed?
	if (proc.exitCode !== null || proc.signalCode !== null) {
		return true;
	}

	// 2. Register one-shot close listener.
	let settled = false;
	let timer: NodeJS.Timeout | undefined;

	return new Promise<boolean>((resolve) => {
		const finish = (value: boolean): void => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			proc.removeListener("close", onClose);
			resolve(value);
		};

		const onClose = (): void => finish(true);

		proc.once("close", onClose);

		// 3. Re-check after listener registration (race window).
		if (proc.exitCode !== null || proc.signalCode !== null) {
			finish(true);
			return;
		}

		// 4. Start timeout only after listener is registered.
		timer = setTimeout(() => finish(false), timeoutMs);
	});
}

/**
 * Check whether the process appears to have closed by inspecting
 * `exitCode`/`signalCode`. Returns true if either is set.
 */
function isClosed(proc: ChildProcess): boolean {
	return proc.exitCode !== null || proc.signalCode !== null;
}

/**
 * Send a signal to a child process, wrapped in try/catch.
 *
 * @returns `true` if kill() returned true, `false` if it returned false or threw.
 */
function safeKill(
	proc: ChildProcess,
	signal: NodeJS.Signals,
): { threw: boolean; returned: boolean; error?: string } {
	try {
		const ok = proc.kill(signal);
		return { threw: false, returned: ok };
	} catch (error) {
		return {
			threw: true,
			returned: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Terminate a child process, escalating SIGTERM → SIGKILL as needed.
 *
 * MUST NOT throw. Always returns `TerminateChildResult`.
 *
 * Lifecycle (design AD3):
 * - already closed → `already_closed`
 * - SIGTERM closes within grace → `terminated`
 * - SIGKILL closes after grace expires → `killed`
 * - no closure after SIGKILL timeout → `failed`
 *
 * Both `proc.kill()` calls are wrapped in try/catch. A `false` return from
 * `kill()` is not by itself proof of failure — the helper re-checks closure.
 */
export async function terminateChild(
	proc: ChildProcess,
	options?: {
		graceMs?: number;
		killMs?: number;
	},
): Promise<TerminateChildResult> {
	const graceMs = options?.graceMs ?? 5000;
	const killMs = options?.killMs ?? 5000;

	// Null/undefined guard — readSerial's pre-spawn abort path may call
	// terminateChild before a process is assigned. No process means nothing
	// to terminate; treat as already closed (MUST NOT throw, AD3).
	if (!proc) {
		return { status: "already_closed" };
	}

	// Already closed?
	if (isClosed(proc)) {
		return { status: "already_closed" };
	}

	// Send SIGTERM.
	const termResult = safeKill(proc, "SIGTERM");

	// Re-check closure immediately (kill may have returned false because the
	// process was already exiting, or thrown because it already exited).
	if (isClosed(proc)) {
		return { status: "terminated", signal: "SIGTERM" };
	}

	// Wait for grace period.
	const termClosed = await waitForClose(proc, graceMs);
	if (termClosed) {
		return { status: "terminated", signal: "SIGTERM" };
	}

	// Re-check after grace (race: closed between timeout and re-check).
	if (isClosed(proc)) {
		return { status: "terminated", signal: "SIGTERM" };
	}

	// SIGTERM was insufficient — escalate to SIGKILL.
	const killResult = safeKill(proc, "SIGKILL");

	// Re-check closure immediately after SIGKILL.
	if (isClosed(proc)) {
		return { status: "killed", signal: "SIGKILL" };
	}

	// Wait for kill period.
	const killClosed = await waitForClose(proc, killMs);
	if (killClosed) {
		return { status: "killed", signal: "SIGKILL" };
	}

	// Final re-check.
	if (isClosed(proc)) {
		return { status: "killed", signal: "SIGKILL" };
	}

	// Closure could not be confirmed.
	const reasons: string[] = [];
	if (termResult.threw) reasons.push(`SIGTERM threw: ${termResult.error}`);
	else if (!termResult.returned) reasons.push("SIGTERM returned false");
	if (killResult.threw) reasons.push(`SIGKILL threw: ${killResult.error}`);
	else if (!killResult.returned) reasons.push("SIGKILL returned false");
	if (reasons.length === 0) {
		reasons.push("process did not close after SIGTERM and SIGKILL");
	}

	return { status: "failed", error: reasons.join("; ") };
}

/**
 * Log a message through an optional sink, swallowing any error.
 *
 * Diagnostics MUST NEVER replace the main operation result. If the sink
 * throws, the exception is captured and discarded.
 */
export function safeLog(log: ((message: string) => void) | undefined, message: string): void {
	try {
		(log ?? console.error)(message);
	} catch {
		// Diagnostics must never replace the main result.
	}
}
