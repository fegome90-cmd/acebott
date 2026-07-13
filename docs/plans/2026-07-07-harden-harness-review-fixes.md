# Harden Harness Review Fixes — Historical Implementation Record

<!-- markdownlint-disable MD010 -->

> **Historical snapshot (2026-07-07):** This file preserves the remediation
> plan and evidence for fixes that have already been applied. It is not an
> executable plan. Treat every command block below as historical evidence only;
> do not rerun or re-stage these steps from this document without a fresh
> branch-state review.

**Historical goal:** Fix 6 findings from the multi-review of `harden-harness-and-docs` — 1 critical bug (early-abort passes `undefined` to `terminateChild`), 4 major issues, and 1 test gap — without regressing the 224 passing tests.

**Architecture:** The fixes are surgical and ordered by dependency. Fix 2 (null-guard in `terminateChild`) is the foundation — it makes `terminateChild` truly non-throwing for any input, which Fix 1 (serial early-abort) then relies on. Fixes 3-4 are independent error-handling improvements. Fixes 5-6 are test-quality gaps. Fixes were executed with RED → GREEN discipline during implementation; this document now records the current source and test evidence for already-applied fixes.

**Tech Stack:** TypeScript 5.x, vitest, biome, Node.js `child_process`. The harness lives under `harness/` and uses `pnpm run build` (tsc), `pnpm run lint` (biome), `pnpm test` (vitest).

**Baseline:** 224 tests passing across 10 files. Build + lint clean.

**Key files:**
- `harness/src/lib/child-process.ts` — `terminateChild`, `isClosed`, `safeKill`, `safeLog`
- `harness/src/lib/serial.ts` — `readSerial`, `selectResult`, `finalize`
- `harness/src/lib/esptool.ts` — `validateFlashArtifacts`, `EsptoolError`
- `harness/src/tools/health.ts` — `runHealthCheck`, `renderHealthResult`, `registerHealthTool`
- `harness/tests/unit/child-process.test.ts` — primitive tests
- `harness/tests/unit/serial.test.ts` — serial tests (terminateChild mocked)
- `harness/tests/unit/health.test.ts` — health orchestration tests
- `harness/tests/unit/esptool.test.ts` — esptool + artifact validation tests

**Historical implementation context:**
- The harness uses tabs for indentation (biome enforces this). Match it.
- `terminateChild` is mocked in `serial.test.ts` and wrapper tests — bugs in the real primitive are invisible there. Tests against the real primitive live in `child-process.test.ts`.
- The `proc` variable in `readSerial` is declared `let proc: ChildProcess | undefined;` (serial.ts:99) and assigned at spawn (serial.ts:205). The early-abort path (serial.ts:180-182) runs before spawn.
- `formatError` and `isAbortError` are module-private in `health.ts` (not exported, not shared).

---

## Task 1: Verify `terminateChild` null-guard (Fix 2 — foundation) — completed

**Status:** Completed before this remediation pass. This section is now verification-only documentation; do not reimplement or re-stage the already-present code.

**Original issue:** `terminateChild` was advertised as "MUST NEVER throw" but previously dereferenced `proc` through `isClosed(proc)`, which could throw `TypeError` when the caller passed `undefined`. That path was reachable from `readSerial` before a child process was spawned.

**Current source evidence:**
- `harness/src/lib/child-process.ts` has a guard at the top of `terminateChild` that returns `{ status: "already_closed" }` when `proc` is falsy, before calling `isClosed(proc)`.
- The guard preserves the contract that a missing child process means there is nothing to terminate and must not produce a thrown exception.

**Current test evidence:**
- `harness/tests/unit/child-process.test.ts` includes `never throws when proc is undefined — returns already_closed`.
- The test calls `terminateChild(undefined as never, { graceMs: 20, killMs: 20 })` and asserts `result.status === "already_closed"`.

**Verification command from repo root:**

```bash
cd harness && pnpm test tests/unit/child-process.test.ts -t "never throws when proc is undefined"
```

**Expected result:** the targeted test passes.

**Traceability:** This verifies Fix 2 from the multi-review remediation: the primitive termination helper no longer throws on `undefined`, and the behavior is locked by a direct primitive-level test rather than only wrapper tests.

---

## Task 2: Verify `readSerial` early-abort `undefined` proc guard (Fix 1 — critical) — completed

**Status:** Completed before this remediation pass. This section is now verification-only documentation; do not reimplement or re-stage the already-present code.

**Original issue:** When `signal.aborted` was already `true` on entry, `selectResult` could resolve before `proc` was assigned. The old `finalize` path passed `proc as ChildProcess` to `terminateChild`, hiding that the value was actually `undefined`.

**Current source evidence:**
- `harness/src/lib/serial.ts` defines `let proc: ChildProcess | undefined` and assigns it only after spawning.
- `finalize` now clears runtime listeners and timer, then returns early when `!proc`, resolving the selected `SerialReadResult` without invoking `terminateChild`.
- After that guard, `proc` is narrowed before `terminateChild(proc)` is called, so the unsafe `as ChildProcess` cast is no longer needed in the termination path.

**Current test evidence:**
- `harness/tests/unit/serial.test.ts` includes `7.6b abort before start does not call terminateChild`.
- The test aborts an `AbortController` before calling `readSerial`, asserts the result status is `cancelled`, and asserts `mockedTerminateChild` was not called.

**Verification command from repo root:**

```bash
cd harness && pnpm test tests/unit/serial.test.ts -t "7.6b"
```

**Expected result:** the targeted test passes.

**Traceability:** This verifies Fix 1 from the multi-review remediation: pre-spawn cancellation resolves as `cancelled` without attempting to terminate a process that does not exist.

---

## Task 3: Fix `pkill` swallowed errors (Fix 3 — major)

**Files:**
- Modify: `harness/src/tools/health.ts:333` (replace `.catch(() => {})` with logging)

**Why:** `pkill -9 -f ACECode` is an operational step the user explicitly approved (they clicked "Kill ACECode and proceed"). An empty `.catch(() => {})` swallows EACCES, ENOENT (pkill missing), and non-zero exit — leaving the user with no idea why the serial port is still busy. This is NOT cleanup (which the design says must not change the primary result); it is a user-requested destructive operation.

### Step 1: Implement the fix

In `harness/src/tools/health.ts`, replace line 333. The line is inside a nested block (the `if (ok)` body of the ACECode-running branch) and is indented with **4 tabs** (verify with `sed -n '333p' src/tools/health.ts | cat -A` → `^\t^\t^\t^\tawait execAsync(...)`). Match this exactly — biome enforces tabs.

```ts
				await execAsync("pkill -9 -f ACECode").catch(() => {});
```

with:

```ts
				try {
					await execAsync("pkill -9 -f ACECode");
				} catch (error) {
					// pkill failure is non-fatal — proceed with health check — but
					// log so the user can correlate a later serial failure with a
					// failed kill. Common cases: ACECode already exited (non-zero
					// exit), pkill not installed (ENOENT), permission denied.
					safeLog(options.log, `pkill ACECode failed: ${formatError(error)}. Serial port may still be busy.`);
				}
```

Note: `safeLog` and `formatError` are both already in scope in `health.ts` (imports at line 27, local function at lines 214-217).

### Step 2: Verify build + lint

Historical command evidence: `cd harness && pnpm run build && pnpm run lint`
Expected: both exit 0.

### Step 3: Run health tests to verify no regression

Historical command evidence: `cd harness && pnpm test tests/unit/health.test.ts`
Expected: 40 tests pass (unchanged count — no new test, just a logging change).

### Step 4: Commit

```bash
# From repo root
git add harness/src/tools/health.ts
git commit -m "fix(health): log pkill ACECode failures instead of swallowing

The empty catch on pkill -9 -f ACECode swallowed EACCES, ENOENT, and
non-zero exit silently. This is an operational step the user approved,
not cleanup — failures should be observable so a later serial error can
be correlated with a failed kill. Use safeLog to preserve the primary
result while surfacing the diagnostic. Found by multi-review."
```

---

## Task 4: Fix `validateFlashArtifacts` error collapse (Fix 4 — major)

**Files:**
- Modify: `harness/src/lib/esptool.ts:100-104` (preserve error code in catch)
- Test: `harness/tests/unit/esptool.test.ts` (add test for permission-denied case)

**Why:** The `stat()` catch block collapses ALL errors (ENOENT, EACCES, EIO, ENOTDIR, etc.) to "not found". A user with a permission problem is told the file is missing, sending them debugging in the wrong direction.

### Step 1: Write the failing test

Add this test to `harness/tests/unit/esptool.test.ts`, inside the `describe("flashSketch artifact validation", ...)` block, after the last `11.x` test (11.6).

**Calling convention note:** `validateFlashArtifacts` is NOT exported and its signature is `validateFlashArtifacts(buildPath: string, sketchName: string)` — it does NOT take an artifacts object. The existing tests 11.1-11.6 exercise it indirectly via `flashSketch({buildPath, sketchName, port})`, which calls `validateFlashArtifacts` internally before spawn. This test MUST follow the same pattern. `mockedStat.mockImplementation` (per-path) is used to make only the bootloader path reject, exactly like tests 11.1 and 11.4 do.

**Double-call bug note:** Do NOT call `flashSketch` twice. `mockRejectedValueOnce` / the per-path `mockImplementation` is consumed on the first call; a second call would either re-trigger the EACCES path or hit a stale mock. Use a single `try/catch` that asserts both the `EsptoolError` type and the message content.

```ts
it("11.7 permission-denied artifact reports access error, not 'not found'", async () => {
	// Simulate EACCES on the bootloader path only — stat rejects with a
	// permission error. Other artifact paths resolve to valid files.
	// `validateFlashArtifacts` is not exported; it is exercised via flashSketch,
	// matching the pattern in tests 11.1 and 11.4.
	const eacces = Object.assign(new Error("permission denied"), {
		code: "EACCES",
	});
	mockedStat.mockImplementation(async (path: unknown) => {
		if (typeof path === "string" && path.endsWith("health_check.ino.bootloader.bin")) {
			throw eacces;
		}
		return validFileStats;
	});

	// Call flashSketch exactly ONCE — the per-path mockImplementation is not
	// consumed the way mockRejectedValueOnce is, but calling twice would still
	// be wasteful and could mask a resolution-vs-rejection race. Capture the
	// error and assert on it outside the catch so a resolution (no throw)
	// produces a clear "expected to throw" failure rather than a confusing one.
	let caught: unknown;
	try {
		await flashSketch({
			buildPath: "/build",
			sketchName: "health_check",
			port: "/dev/cu.usbserial-110",
		});
	} catch (error) {
		caught = error;
	}

	expect(caught).toBeInstanceOf(EsptoolError);
	const msg = (caught as EsptoolError).message;
	// The error message must NOT say "not found" — it should indicate an
	// access problem and include the error code.
	expect(msg).not.toContain("not found");
	expect(msg).toContain("EACCES");
});
```

Note: `validFileStats`, `mockedStat`, `EsptoolError`, and `flashSketch` are all already in scope in this test file (see the top of `esptool.test.ts` and the `beforeEach` in the artifact-validation describe block). No new imports are needed.

### Step 2: Run test to verify it fails

Historical command evidence: `cd harness && pnpm test tests/unit/esptool.test.ts -t "11.7"`
Expected: FAIL — the error message contains "not found" and does not contain "EACCES".

### Step 3: Implement the fix

In `harness/src/lib/esptool.ts`, replace lines 100-104. The exact current indentation (tabs) is 2 tabs for `const stats`/`});` and 3 tabs for `throw`/the message/`);`:

```ts
		const stats = await stat(artifact.path).catch(() => {
			throw new EsptoolError(
				`Required flash artifact ${artifact.label} not found: ${artifact.path}`,
			);
		});
```

with (preserving the same 2-tab / 3-tab indentation):

```ts
		const stats = await stat(artifact.path).catch((error: NodeJS.ErrnoException) => {
			// Preserve the original error code so callers can distinguish
			// "missing" (ENOENT) from "permission denied" (EACCES) from "I/O
			// error" (EIO). Collapsing all to "not found" misdirects debugging.
			const code = error?.code ?? "UNKNOWN";
			throw new EsptoolError(
				`Required flash artifact ${artifact.label} could not be accessed (${code}): ${artifact.path}`,
			);
		});
```

The `for` loop body is indented with 2 tabs (the `for` itself is at 1 tab inside `validateFlashArtifacts`), and statements inside the `.catch` arrow are at 3 tabs. Match this exactly — biome enforces tabs.

### Step 4: Run test to verify it passes

Historical command evidence: `cd harness && pnpm test tests/unit/esptool.test.ts -t "11.7"`
Expected: PASS

### Step 5: Update existing tests that assert "not found"

The new message format is `could not be accessed (ENOENT)` instead of `not found`. Existing tests 11.1 (missing bootloader) and 11.4 (missing boot_app0) throw a plain `new Error("ENOENT")` — which has `error.code === undefined`, so the fallback produces `could not be accessed (UNKNOWN)`. Either update those mocks to attach `code: "ENOENT"` (preferred, so the assertion is meaningful) or assert `could not be accessed` generically.

Grep for assertions that check the old message:
```bash
rg -n "not found" harness/tests/unit/esptool.test.ts
```

For each match:
- If it is in the `flashSketch artifact validation` describe block (tests 11.1/11.2/11.4 area — the `validateFlashArtifacts` code path), update it to assert `could not be accessed` instead (and `ENOENT` if you attached the code to the mock error).
- **Do NOT change the `esptool not found` assertion at line 122** (`expect(...).rejects.toThrow("esptool not found")` in the `flashSketch` describe block). That is a different code path — `checkEsptoolAvailable` / the "esptool binary missing" branch at `esptool.ts:127` — and its message is unchanged by this fix. Only update assertions related to `validateFlashArtifacts` (artifact validation).

### Step 6: Run full esptool suite to verify no regression

Historical command evidence: `cd harness && pnpm test tests/unit/esptool.test.ts`
Expected: 24 tests pass (was 23, +1 new). This must come AFTER Step 5 — test 11.1 will fail until its "not found" assertion is updated to the new message.

### Step 7: Run build + lint

Historical command evidence: `cd harness && pnpm run build && pnpm run lint`
Expected: both exit 0.

### Step 8: Commit

```bash
# From repo root
git add harness/src/lib/esptool.ts harness/tests/unit/esptool.test.ts
git commit -m "fix(esptool): preserve stat error code in artifact validation

validateFlashArtifacts collapsed all stat() failures (ENOENT, EACCES,
EIO, ENOTDIR) to 'not found', misdirecting debugging when the file
exists but is unreadable. Preserve the original error code in the
message so callers can distinguish missing vs. permission-denied vs.
I/O error. Found by multi-review silent-failure hunter."
```

---

## Task 5: Deepen test 9.13 priority assertions (Fix 5 — major)

**Files:**
- Modify: `harness/tests/unit/health.test.ts:323-341` (add assertions to existing test)

**Why:** Test 9.13 is the critical priority test — `ChildTerminationError` + aborted signal must return `error`, not `cancelled`. But it only asserts `result.status === "error"`. A regression that mapped the combined case to a generic `operation_failed` error (without the termination metadata) would pass. Add assertions for `code`, `processMayStillBeRunning`, and `stage`.

### Step 1: Add assertions to test 9.13

In `harness/tests/unit/health.test.ts`, replace lines 339-341:

```ts
		// Priority: ChildTerminationError wins over cancellation.
		expect(result.status).toBe("error");
	});
```

with:

```ts
		// Priority: ChildTerminationError wins over cancellation.
		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.code).toBe("child_termination_unconfirmed");
			expect(result.processMayStillBeRunning).toBe(true);
			expect(result.stage).toBe("compile");
		}
	});
```

### Step 2: Run test to verify it passes

Historical command evidence: `cd harness && pnpm test tests/unit/health.test.ts -t "9.13"`
Expected: PASS — the implementation already produces these fields (verified in sdd-verify); the test just wasn't checking them.

### Step 3: Run full health suite to verify no regression

Historical command evidence: `cd harness && pnpm test tests/unit/health.test.ts`
Expected: 40 tests pass (unchanged count — same test, deeper assertions).

### Step 4: Commit

```bash
# From repo root
git add harness/tests/unit/health.test.ts
git commit -m "test(health): deepen 9.13 priority assertions

Test 9.13 (ChildTerminationError + aborted signal → error, not
cancelled) only asserted result.status. A regression mapping the
combined case to a generic operation_failed error would pass. Add
assertions for code, processMayStillBeRunning, and stage to lock the
priority contract. Found by multi-review test analyzer."
```

---

## Task 6: Test `renderHealthResult` neutral semantics (Fix 6 — major)

**Files:**
- Modify: `harness/src/tools/health.ts:552` (add `export` to `renderHealthResult`)
- Create: `harness/tests/unit/render-health.test.ts`

**Why:** Task 9.40 claims "`protocol_complete` is not rendered as 'healthy', 'passed', or equivalent". But the test only asserts on `result.status` (the enum, which is `"protocol_complete"` by construction) — not on the rendered text. `renderHealthResult` is private and untested, so a rendering regression to "HEALTHY: ALL PASSED" would pass the suite. Export the function and test the actual rendered output.

### Step 1: Export `renderHealthResult`

In `harness/src/tools/health.ts`, line 552, add `export`:

```ts
export function renderHealthResult(result: HealthCheckResult): {
```

Do NOT add it to `index.ts` — it is an internal function; tests import directly from `src/tools/health.ts`.

### Step 2: Create the test file

Create `harness/tests/unit/render-health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { HealthCheckResult } from "../../src/tools/health.js";
import { renderHealthResult } from "../../src/tools/health.js";

// Minimal valid HealthCheckContext for all variants.
const ctx = {
	stage: "complete" as const,
	detect: undefined,
	flashed: false,
};

// Minimal valid HealthReport for protocol_complete.
// NOTE: HealthReport (src/lib/parser.ts) uses `string` for all status fields,
// `number | null` for tracking values, and `number | null` for distance. Do NOT
// use booleans — match the interface exactly or tsc will reject this.
const report = {
	leds: { left: "ok", right: "ok" },
	buzzer: "ok",
	motors: { tested: "4", fl: "ok", fr: "ok", bl: "ok", br: "ok" },
	ultrasonic: { distance_cm: 25 },
	tracking: { left: 1, middle: 0, right: 1 },
	ir: { code: "0x10" },
	result: "pass" as const,
};

describe("renderHealthResult — neutral semantics (REQ-011)", () => {
	it("protocol_complete renders 'Protocol complete', never 'healthy' or 'passed'", () => {
		const result: HealthCheckResult = {
			...ctx,
			status: "protocol_complete",
			report,
		};
		const rendered = renderHealthResult(result);
		const text = rendered.content[0].text;

		expect(text).toContain("Protocol complete");
		// Forbidden diagnostic language — must never appear for protocol_complete.
		expect(text).not.toMatch(/healthy/i);
		expect(text).not.toMatch(/passed/i);
		expect(text).not.toMatch(/all components working/i);
		expect(text).not.toMatch(/diagnosis successful/i);
	});

	it("error with child_termination_unconfirmed warns about preserved artifacts", () => {
		const result: HealthCheckResult = {
			stage: "compile",
			detect: undefined,
			flashed: false,
			status: "error",
			error: "compile child termination unconfirmed",
			code: "child_termination_unconfirmed",
			processMayStillBeRunning: true,
			cleanupSkipped: true,
			artifactsPreservedAt: "/tmp/build-xyz",
			partialData: [],
		};
		const rendered = renderHealthResult(result);
		const text = rendered.content[0].text;

		expect(text).toContain("process may still be running");
		expect(text).toContain("/tmp/build-xyz");
	});

	it("cancelled renders 'Cancelled'", () => {
		const result: HealthCheckResult = {
			stage: "serial",
			detect: undefined,
			flashed: true,
			status: "cancelled",
			partialData: [],
		};
		const rendered = renderHealthResult(result);
		expect(rendered.content[0].text).toBe("Cancelled");
	});

	it("timeout renders timeout message with line count", () => {
		const result: HealthCheckResult = {
			stage: "serial",
			detect: undefined,
			flashed: true,
			status: "timeout",
			partialData: ["line1", "line2"],
		};
		const rendered = renderHealthResult(result);
		expect(rendered.content[0].text).toContain("timed out");
		expect(rendered.content[0].text).toContain("2 line(s)");
	});

	it("incomplete renders exit code and line count", () => {
		const result: HealthCheckResult = {
			stage: "serial",
			detect: undefined,
			flashed: true,
			status: "incomplete",
			partialData: ["line1"],
			exitCode: 0,
		};
		const rendered = renderHealthResult(result);
		expect(rendered.content[0].text).toContain("incomplete");
		expect(rendered.content[0].text).toContain("code 0");
	});
});
```

### Step 3: Run tests to verify they pass

Historical command evidence: `cd harness && pnpm test tests/unit/render-health.test.ts`
Expected: 5 tests pass. The implementation already renders neutral language; these tests lock it in.

### Step 4: Run build + lint

Historical command evidence: `cd harness && pnpm run build && pnpm run lint`
Expected: both exit 0. The `export` keyword should not cause issues.

### Step 5: Commit

```bash
# From repo root
git add harness/src/tools/health.ts harness/tests/unit/render-health.test.ts
git commit -m "test(health): cover renderHealthResult neutral semantics

renderHealthResult was private and untested — test 9.40 only asserted
on result.status (the enum), not the rendered text. A regression to
'HEALTHY: ALL PASSED' would pass the suite. Export the function and
test the actual content[0].text for forbidden diagnostic language
(healthy/passed/all components working) across all 5 result variants.
Found by multi-review test analyzer."
```

---

## Task 7: Final validation

**Files:** none (verification only)

### Step 1: Run full test suite

Historical command evidence: `cd harness && pnpm test`
Expected: all tests pass. Count should be **233 tests** across 11 files in
the final post-review validation (baseline 224 → final 233).

### Step 2: Run build + lint

Historical command evidence: `cd harness && pnpm run build && pnpm run lint`
Expected: both exit 0.

### Step 3: Verify no regression in existing assertions

If Task 4 changed the esptool error message, existing tests 11.1-11.2 that asserted "not found" were updated in Task 4 Step 5 (the assertion-update step, which now runs before the full suite in Step 6). Confirm:

Historical command evidence: `rg -n "not found" harness/tests/unit/esptool.test.ts`
Expected: only the `esptool not found` match at line ~122 (the `checkEsptoolAvailable` code path, which was intentionally NOT changed). No matches in the `flashSketch artifact validation` describe block (tests 11.1/11.2/11.4) — those should now assert `could not be accessed`.

### Step 4: Update apply-progress.md

Append a "## Post-review fixes" section to `openspec/changes/harden-harness-and-docs/apply-progress.md` documenting:
- 6 fixes applied (list each with task number)
- Test count: 224 → 233
- Build/lint/test: all pass
- Multi-review findings addressed: 1 critical, 4 major, 1 test gap

### Step 5: Commit progress update

```bash
# From repo root
git add openspec/changes/harden-harness-and-docs/apply-progress.md
git commit -m "docs(apply-progress): record post-review fixes

6 fixes from multi-review: critical early-abort undefined proc,
terminateChild null-guard, pkill logging, stat error preservation,
9.13 deepened assertions, renderHealthResult test coverage. Test
count 224 → 233, build/lint/test all pass."
```

---

## Summary

| Task | Fix | Severity | Files | New tests |
|------|-----|----------|-------|-----------|
| 1 | `terminateChild` null-guard | MAJOR (foundation) | `child-process.ts` | +1 |
| 2 | `readSerial` early-abort guard | CRITICAL | `serial.ts` | +1 |
| 3 | `pkill` error logging | MAJOR | `health.ts` | 0 |
| 4 | `validateFlashArtifacts` error preservation | MAJOR | `esptool.ts` | +1 |
| 5 | Test 9.13 deepened assertions | MAJOR | `health.test.ts` | 0 |
| 6 | `renderHealthResult` test coverage | MAJOR | `health.ts` + new test | +5 |
| 7 | Final validation | — | `apply-progress.md` | 0 |

**Final test count:** 224 → 233

### Final 233-test inventory

The final unit-test count is reconciled per file:

| Test file | Tests |
|-----------|------:|
| `harness/tests/unit/arduino-cli.test.ts` | 15 |
| `harness/tests/unit/child-process.test.ts` | 24 |
| `harness/tests/unit/constants.test.ts` | 26 |
| `harness/tests/unit/detect.test.ts` | 9 |
| `harness/tests/unit/esptool.test.ts` | 24 |
| `harness/tests/unit/health.test.ts` | 40 |
| `harness/tests/unit/parsers.test.ts` | 10 |
| `harness/tests/unit/render-health.test.ts` | 5 |
| `harness/tests/unit/serial.test.ts` | 21 |
| `harness/tests/unit/skills.test.ts` | 52 |
| `harness/tests/unit/usb.test.ts` | 7 |
| **Total** | **233** |

This reconciles the final delta from the 224-test baseline: +1
child-process null-guard test, +2 serial early-abort/termination-route tests,
+1 esptool permission-denied artifact test, and +5 render-health tests.

**Out of scope (deferred to follow-up):**
- Dead code `abort.ts` removal (minor)
- `settleWrapper`/`settleFlashWrapper` deduplication (minor)
- `HealthToolResult` deprecated export removal (nit)
- `readonly string[]` for array fields (minor, type design)
- `mapSerialResult` spec drift in design.md §13 (minor, doc)
- JSDoc gaps on `terminateChild`/`readSerial` params (nit)
