/**
 * Shared abort-signal helpers for subprocess wrappers.
 *
 * Correct usage: every wrapper that registers an abort listener MUST call the
 * returned cleanup function when the process settles (in both close and error
 * callbacks) to avoid leaking listeners on long-lived signals.
 */

/**
 * Attach an abort listener that kills the process. Returns a cleanup function
 * that removes the listener — call it when the process settles.
 *
 * @example
 * ```ts
 * const cleanup = attachAbort(signal, proc);
 * proc.on("close", () => { cleanup(); resolve(...); });
 * proc.on("error", () => { cleanup(); resolve(...); });
 * ```
 */
export function attachAbort(
	signal: AbortSignal | undefined,
	proc: { kill(signal?: NodeJS.Signals | number | string): boolean },
): () => void {
	if (!signal) return () => {};
	if (signal.aborted) {
		proc.kill("SIGTERM");
		return () => {};
	}
	const onAbort = () => proc.kill("SIGTERM");
	signal.addEventListener("abort", onAbort, { once: true });
	return () => signal.removeEventListener("abort", onAbort);
}
