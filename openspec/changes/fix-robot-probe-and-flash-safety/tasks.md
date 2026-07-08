# Tasks — fix-robot-probe-and-flash-safety

## Phase 1: PR1 — disable dishonest health flow

- [ ] 1.1 Replace executable `robot_health` registration in `harness/src/index.ts` and `harness/src/tools/health.ts` or successor with an unavailable migration stub.
- [ ] 1.2 Retire or rename public health exports in `harness/src/index.ts` and `harness/src/lib/parser.ts` so the public parser/report API no longer exposes `pass`, `healthy`, or `t:"health"` semantics.
- [ ] 1.3 Test that `robot_health` never compiles, flashes, or returns `pass`, `healthy`, or health conclusions.
- [ ] 1.4 Add probe-facing contract/constants without registering destructive execution.

## Phase 2: PR2 foundation — shared safe pipeline before destructive gate

- [ ] 2.1 Implement `DeviceCandidate`/`DetectionResult` with only `none`, `unique`, `ambiguous`, and `invalid_override`; surface `unknown_bridge` and `busy_port` as explicit blocked reasons before `write_flash`.
- [ ] 2.2 Implement trusted runtime adapter: missing, error, false, or untrusted capability default-denies destructive registration; args cannot override it.
- [ ] 2.3 Add `pnpm robot:probe` CLI fallback now, wired to the same pipeline as MCP before/with destructive gating.
- [ ] 2.4 Add kill-switch config/env path that disables destructive MCP and CLI flash; test registration/invocation fails before flash.

## Phase 3: Preflight, artifacts, and tokens

- [ ] 3.1 Implement preflight: detect, fingerprint `chip_id`/`read_mac` plus USB identity, compile once, validate owned artifacts, compute hashes.
- [ ] 3.2 Store `FlashPlan`, manifest, `FlashPlanSummary`, `ConfirmationRecord`, and token hash in controlled harness-owned storage.
- [ ] 3.3 Implement atomic token states: `pending -> executing -> consumed|invalidated`, `pending -> expired`; no post-start path returns to `pending`.
- [ ] 3.4 Revalidate port/fingerprint/files/hashes before flash; deleted, modified, wrong-owner, or cleanup-failed artifacts block or invalidate without flash.
- [ ] 3.5 Ensure execution reuses approved artifacts and never recompiles after approval.

## Phase 4: Protocol, execution, reporting

- [ ] 4.1 Emit protocol v1 terminal `probe_complete` from firmware and parse only v1 completion.
- [ ] 4.2 Map legacy `health/pass` to public `ProbeReport.probe.status="protocol_mismatch"`; keep unknown/malformed protocol as `protocol_error`.
- [ ] 4.3 Implement strict esptool outcome and cancellation: cancel before flash stops; normal cancel after flash start never kills esptool.
- [ ] 4.4 Return split `ProbeReport` with `flash.status`, `probe.status`, `serial_error` distinct from timeout, and `diagnosticConclusion:"not_available"`.
- [ ] 4.5 On interrupted flash, return `flash.status="interrupted"` and set token state `invalidated`.

## Phase 5: Verification

- [ ] 5.1 Add parser tests for v1, `protocol_mismatch`, protocol errors, timeout, and `serial_error`.
- [ ] 5.2 Add detection/approval tests for ambiguous, invalid override, unknown bridge, busy port, capability missing/error/untrusted, and args ignored.
- [ ] 5.3 Add token/artifact tests for atomicity, expiry, post-start interruption/failure terminality, deletion/modification, cleanup fail-closed, and no-reuse.
- [ ] 5.4 Add CLI tests for TTY requirement, typed confirmation, shared hashes/fingerprint display, non-interactive rejection, and kill-switch.
- [ ] 5.5 Add report/esptool tests for flash completed/probe timeout, flash completed/serial error, flash interrupted/token invalidated, and no health claims.
- [ ] 5.6 Run harness unit tests and typecheck/build; hardware flash validation only when approved hardware is intentionally available.
