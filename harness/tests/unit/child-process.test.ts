/**
 * Unit tests for child-process lifecycle primitives.
 *
 * Verifies race-safe `waitForClose` and non-throwing `terminateChild`
 * (design AD1–AD3, REQ-001).
 */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ChildTerminationError,
	safeLog,
	terminateChild,
	waitForClose,
} from "../../src/lib/child-process.js";

/**
 * Create a mock ChildProcess with controllable exitCode/signalCode/kill.
 * The mock emits `close` when requested and tracks kill() calls.
 */
function createMockProc(overrides?: {
	exitCode?: number | null;
	signalCode?: NodeJS.Signals | null;
	killed?: boolean;
}) {
	const proc = new EventEmitter() as EventEmitter & {
		exitCode: number | null;
		signalCode: NodeJS.Signals | null;
		killed: boolean;
		kill: ReturnType<typeof vi.fn>;
		stdout: EventEmitter;
		stderr: EventEmitter;
	};
	proc.exitCode = overrides?.exitCode ?? null;
	proc.signalCode = overrides?.signalCode ?? null;
	proc.killed = overrides?.killed ?? false;
	proc.kill = vi.fn((signal?: NodeJS.Signals | number | string) => {
		proc.killed = true;
		// Track which signal was requested for assertion
		(proc as unknown as { _lastSignal?: unknown })._lastSignal = signal;
		return true;
	});
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	return proc;
}

describe("waitForClose", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns true immediately for an already-closed process (exitCode set)", async () => {
		const proc = createMockProc({ exitCode: 0 });
		const start = Date.now();

		const result = await waitForClose(proc as never, 1000);

		expect(result).toBe(true);
		// Should not have waited the full timeout
		expect(Date.now() - start).toBeLessThan(500);
	});

	it("returns true immediately for an already-closed process (signalCode set)", async () => {
		const proc = createMockProc({ signalCode: "SIGTERM" });

		const result = await waitForClose(proc as never, 1000);

		expect(result).toBe(true);
	});

	it("observes close between initial check and listener registration (race-safe)", async () => {
		const proc = createMockProc();
		// Simulate the race: close fires at the moment the listener is being
		// registered (after the initial check saw exitCode === null). The
		// re-check after registration must observe the now-set exitCode.
		const originalOnce = proc.once.bind(proc);
		const overrideOnce = (event: string, listener: (...args: unknown[]) => void) => {
			const result = originalOnce(event, listener as never);
			if (event === "close") {
				// Close fires during the registration window — exitCode set,
				// but our listener hasn't had a chance to run yet.
				proc.exitCode = 0;
			}
			return result;
		};
		// Cast: EventEmitter.once has overloaded typings; we override behavior.
		(proc as unknown as { once: typeof overrideOnce }).once = overrideOnce;

		const start = Date.now();
		const result = await waitForClose(proc as never, 1000);

		expect(result).toBe(true);
		expect(Date.now() - start).toBeLessThan(500);
	});

	it("returns false on timeout without close", async () => {
		const proc = createMockProc();

		const result = await waitForClose(proc as never, 50);

		expect(result).toBe(false);
	});

	it("returns true when close fires before timeout", async () => {
		const proc = createMockProc();

		const promise = waitForClose(proc as never, 1000);
		setTimeout(() => {
			proc.exitCode = 0;
			proc.emit("close", 0, null);
		}, 10);

		const result = await promise;

		expect(result).toBe(true);
	});

	it("removes its close listener after closure (no leak)", async () => {
		const proc = createMockProc();
		const before = proc.listenerCount("close");

		await waitForClose(proc as never, 1000).catch(() => false);
		// Force closure path
		proc.exitCode = 0;
		proc.emit("close", 0, null);

		// After closure the listener should have been removed.
		const after = proc.listenerCount("close");
		expect(after).toBeLessThanOrEqual(before);
	});

	it("removes its close listener after timeout (no leak)", async () => {
		const proc = createMockProc();
		const before = proc.listenerCount("close");

		await waitForClose(proc as never, 30);

		const after = proc.listenerCount("close");
		expect(after).toBeLessThanOrEqual(before);
	});

	it("clears its timer after closure", async () => {
		const proc = createMockProc();

		const promise = waitForClose(proc as never, 5000);
		setTimeout(() => {
			proc.exitCode = 0;
			proc.emit("close", 0, null);
		}, 10);

		const start = Date.now();
		await promise;
		// If timer were not cleared, we'd wait ~5000ms. Confirm it returned fast.
		expect(Date.now() - start).toBeLessThan(500);
	});

	it("clears its timer after timeout", async () => {
		const proc = createMockProc();

		const start = Date.now();
		await waitForClose(proc as never, 40);

		// Should return roughly at the timeout, not later (no lingering timer).
		expect(Date.now() - start).toBeLessThan(500);
	});
});

describe("terminateChild", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns already_closed without calling kill() when process already exited", async () => {
		const proc = createMockProc({ exitCode: 0 });

		const result = await terminateChild(proc as never);

		expect(result).toEqual({ status: "already_closed" });
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("returns terminated when SIGTERM closes the process within grace", async () => {
		const proc = createMockProc();
		// Simulate SIGTERM causing closure shortly after kill() is called.
		proc.kill = vi.fn((signal?: NodeJS.Signals | number | string) => {
			void signal;
			// Close on next tick to simulate graceful termination.
			setTimeout(() => {
				proc.exitCode = 0;
				proc.signalCode = "SIGTERM";
				proc.emit("close", 0, "SIGTERM");
			}, 0);
			return true;
		});

		const result = await terminateChild(proc as never, { graceMs: 1000 });

		expect(result).toEqual({ status: "terminated", signal: "SIGTERM" });
		expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
		// SIGKILL must NOT be sent when SIGTERM succeeded.
		expect(proc.kill).not.toHaveBeenCalledWith("SIGKILL");
	});

	it("escalates to SIGKILL when SIGTERM does not close within grace", async () => {
		const proc = createMockProc();
		proc.kill = vi.fn((signal?: NodeJS.Signals | number | string) => {
			if (signal === "SIGKILL") {
				// Only close on SIGKILL.
				setTimeout(() => {
					proc.exitCode = null;
					proc.signalCode = "SIGKILL";
					proc.emit("close", null, "SIGKILL");
				}, 0);
			}
			return true;
		});

		const result = await terminateChild(proc as never, {
			graceMs: 20,
			killMs: 1000,
		});

		expect(result).toEqual({ status: "killed", signal: "SIGKILL" });
		expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
		expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
	});

	it("returns failed when neither SIGTERM nor SIGKILL produces closure", async () => {
		const proc = createMockProc();
		// kill() returns true but process never emits close.
		proc.kill = vi.fn(() => true);

		const result = await terminateChild(proc as never, {
			graceMs: 20,
			killMs: 20,
		});

		expect(result.status).toBe("failed");
		expect(typeof result).toBe("object");
		if (result.status === "failed") {
			expect(typeof result.error).toBe("string");
			expect(result.error.length).toBeGreaterThan(0);
		}
	});

	it("kill() returning false is not treated as failure if closure is subsequently confirmed", async () => {
		const proc = createMockProc();
		proc.kill = vi.fn((signal?: NodeJS.Signals | number | string) => {
			// First kill returns false (e.g. process exiting on its own),
			// but closure happens immediately after.
			if (signal === "SIGTERM") {
				setTimeout(() => {
					proc.exitCode = 0;
					proc.signalCode = "SIGTERM";
					proc.emit("close", 0, "SIGTERM");
				}, 0);
				return false;
			}
			return true;
		});

		const result = await terminateChild(proc as never, { graceMs: 1000 });

		// Because closure was confirmed despite kill() returning false,
		// the result should NOT be "failed".
		expect(result.status).not.toBe("failed");
	});

	it("returns controlled failed when SIGTERM kill() throws", async () => {
		const proc = createMockProc();
		proc.kill = vi.fn((signal?: NodeJS.Signals | number | string) => {
			if (signal === "SIGTERM") {
				throw new Error("ESRCH: no such process");
			}
			// SIGKILL also throws — process truly gone/unreachable.
			throw new Error("ESRCH: no such process");
		});

		const result = await terminateChild(proc as never, {
			graceMs: 20,
			killMs: 20,
		});

		// Throwing kill must be caught; result is failed (closure unconfirmed).
		expect(result.status).toBe("failed");
	});

	it("returns controlled failed when SIGKILL kill() throws after SIGTERM fails", async () => {
		const proc = createMockProc();
		let termCalled = false;
		proc.kill = vi.fn((signal?: NodeJS.Signals | number | string) => {
			if (signal === "SIGTERM") {
				termCalled = true;
				// SIGTERM does nothing, no closure.
				return true;
			}
			if (signal === "SIGKILL") {
				throw new Error("EPERM: operation not permitted");
			}
			return true;
		});

		const result = await terminateChild(proc as never, {
			graceMs: 20,
			killMs: 20,
		});

		expect(termCalled).toBe(true);
		expect(result.status).toBe("failed");
	});

	it("never throws — always returns a TerminateChildResult", async () => {
		const proc = createMockProc();
		proc.kill = vi.fn(() => {
			throw new Error("unexpected");
		});

		// Must not reject.
		const result = await terminateChild(proc as never, {
			graceMs: 20,
			killMs: 20,
		});

		expect(result.status).toBe("failed");
	});

	it("never throws when proc is undefined — returns already_closed", async () => {
		// terminateChild is contract-bound not to throw for ANY input, including
		// undefined (which happens in readSerial's pre-spawn abort path).
		const result = await terminateChild(undefined as never, {
			graceMs: 20,
			killMs: 20,
		});

		expect(result.status).toBe("already_closed");
	});
});

describe("ChildTerminationError", () => {
	it("sets processMayStillBeRunning = true", () => {
		const err = new ChildTerminationError("boom", {
			status: "failed",
			error: "no closure",
		});

		expect(err.processMayStillBeRunning).toBe(true);
		expect(err.name).toBe("ChildTerminationError");
		expect(err.message).toBe("boom");
		expect(err.termination).toEqual({
			status: "failed",
			error: "no closure",
		});
	});

	it("is an instance of Error", () => {
		const err = new ChildTerminationError("x", { status: "already_closed" });

		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(ChildTerminationError);
	});
});

describe("safeLog", () => {
	it("calls the sink with the message when provided", () => {
		const sink = vi.fn();
		safeLog(sink, "hello");

		expect(sink).toHaveBeenCalledWith("hello");
	});

	it("falls back to console.error when sink is undefined", () => {
		const original = console.error;
		const fake = vi.fn();
		console.error = fake;
		try {
			safeLog(undefined, "fallback");
			expect(fake).toHaveBeenCalledWith("fallback");
		} finally {
			console.error = original;
		}
	});

	it("swallows errors from the sink without throwing", () => {
		const throwingSink = (): void => {
			throw new Error("sink exploded");
		};

		expect(() => safeLog(throwingSink, "msg")).not.toThrow();
	});

	it("swallows errors from console.error fallback without throwing", () => {
		const original = console.error;
		console.error = (): void => {
			throw new Error("console broken");
		};
		try {
			expect(() => safeLog(undefined, "msg")).not.toThrow();
		} finally {
			console.error = original;
		}
	});
});
