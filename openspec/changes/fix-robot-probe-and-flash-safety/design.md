# Design: Fix Robot Probe and Flash Safety

## Approach

PR1 disables `robot_health`. PR2 adds one shared safe pipeline used by MCP and CLI: detect target, fingerprint chip/USB, compile once, validate controlled artifacts, hash exact binaries, store a flash plan, consume a single-use token, revalidate device and hashes, run esptool, then report flash and probe separately. No path reports robot health.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Release order | PR1 stub, PR2 probe | Flash is unreachable while semantics change. |
| Unapproved host | No destructive MCP tool; expose CLI alternative | Resolves contradiction: absent tool plus local fallback. |
| Approval source | `TrustedRuntimeCapabilities` from trusted host adapter only | Args cannot enable destructive mode. Missing/error/untrusted default-deny. |
| Artifacts | Owned temp/work dir with manifest `{path,size,sha256,address}` | Enables tamper/deletion checks and cleanup policy. |
| Execution | Reuse approved binaries; never recompile after approval | Avoids TOCTOU. |
| Outcomes | `flash.status` and `probe.status` split | Flash success is not probe success or health. |

## Flow

    robot_health -> unavailable(robot_health_was_removed, replacement=robot_probe_preflight)

Approved MCP or interactive CLI both call the same pipeline:

    preflight -> detect(none|unique|ambiguous|invalid_override) -> reject busy/unsafe port
      -> chip_id/read_mac + USB identity -> compile -> validate owned artifacts -> sha256
      -> store ConfirmationRecord(pending, manifest, flashPlanHash) -> show summary/token
    execute(token) -> atomic pending->executing -> revalidate port/fingerprint/hashes/files
      -> write_flash approved artifacts -> strict esptool terminal status
      -> serial probe parser -> ProbeReport -> cleanup/diagnostics

Unapproved MCP registration:

    trusted capabilities missing|error|false|untrusted -> do not register robot_probe; report alternative pnpm robot:probe

Token states: `pending -> executing -> consumed|invalidated`; `pending -> expired`. After `executing`, failure, interruption, cancellation terminal outcome, artifact mismatch, or serial subsystem failure never returns to `pending`. Interrupted flash yields `report.flash.status="interrupted"` and token `invalidated`.

## Contracts

```ts
type TrustedRuntimeCapabilities = Readonly<{ mandatoryHumanApproval: true; source: "host_adapter"; trusted: true }>;
type DetectionResult = {kind:"none"}|{kind:"unique";candidate:DeviceCandidate}|{kind:"ambiguous";candidates:DeviceCandidate[]}|{kind:"invalid_override";port:string;reason:"not_found"|"not_device"|"not_serial"|"not_accessible"|"busy_port"};
type BlockReason = "no_candidates"|"multiple_candidates"|"invalid_override"|"busy_port"|"unknown_bridge"|"chip_detection_failed"|"unsupported_chip"|"compile_failed"|"incomplete_binaries"|"artifact_validation_failed"|"artifact_missing"|"artifact_modified"|"cleanup_failed";
type ConfirmationState = "pending"|"executing"|"consumed"|"invalidated"|"expired";
type FlashArtifact = { address:string; path:string; sha256:string; sizeBytes:number; owner:"probe_preflight" };
type FlashPlan = { port:string; deviceFingerprint:DeviceFingerprint; baudRate:115200; artifacts:FlashArtifact[]; expiresAt:string };
type ProbeReport = { flash:{status:"not_started"|"completed"|"failed"|"interrupted"}; probe:{status:"not_started"|"completed"|"timeout"|"protocol_error"|"protocol_mismatch"|"serial_error"}; diagnosticConclusion:"not_available"; manualVerificationRequired:true; observations:ProbeObservation[] };
```

Protocol v1 completion is exactly `{"v":1,"t":"probe_complete","result":"completed"}`. Legacy `health/pass` maps to public `probe.status="protocol_mismatch"`.

## Storage and Cleanup

Flash plans live in controlled harness-owned storage, not caller-supplied paths. Execute blocks if an artifact is deleted, size/hash changes, ownership is wrong, or cleanup failure leaves unsafe reusable state. Expired/consumed/invalidated plans delete artifacts when safe; interrupted flash may retain diagnostics but the token remains invalidated.

## Tests

Unit tests cover: stub behavior; protocol v1 and `protocol_mismatch`; `serial_error` distinct from timeout; discriminated detection including busy port; fail-closed capability states and args ignored; MCP/CLI shared pipeline; no recompile during execute; artifact deleted/modified/cleanup-failed states; strict esptool success; no normal cancel kill after flash start; interrupted flash report/token state; kill-switch disabling destructive path.
