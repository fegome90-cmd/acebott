# Spec — fix-robot-probe-and-flash-safety

## Requirements

### REQ-001: Legacy health path is non-executable

`robot_health` MUST never compile, flash, probe, or claim health.

- Given PR1, when `robot_health` is called, then no compile/flash occurs and result is `unavailable`, `robot_health_was_removed`, `robot_probe_preflight`, `replacementAvailable:false`.
- Given public contracts, when inspected, then they contain no `pass`, `healthy`, or equivalent health conclusion.

### REQ-002: Probe protocol and public outcome are explicit

Probe output MUST use protocol v1 and public `ProbeReport.probe.status` MUST include `protocol_mismatch`.

- Given terminal firmware output, when parsed, then it accepts only `{"v":1,"t":"probe_complete","result":"completed"}` as completion.
- Given `{"t":"health","result":"pass"}`, when parsed, then `probe.status` is `protocol_mismatch` and no completion is inferred.
- Given unknown protocol version, malformed protocol, no terminal line, timeout, or serial subsystem failure, when parsing ends, then status is respectively `protocol_error`, `protocol_error`, non-completed, `timeout`, or `serial_error`.

### REQ-003: Detection blocks unsafe targets before flash

Detection MUST discriminate `none | unique | ambiguous | invalid_override` and MUST block unsafe conditions before `write_flash`.

- Given multiple candidates, invalid override, unknown bridge without explicit approval, unsupported chip, or busy/inaccessible port, when preflight/execute runs, then no `write_flash` call occurs and reason is explicit, including `busy_port` when the port is already held.
- Given one known available candidate, when preflight runs, then detection returns `unique` with USB identity when available.

### REQ-004: Preflight freezes a controlled flash plan

Preflight MUST compile once, validate controlled artifacts, hash them, and store an owned `ConfirmationRecord`.

- Given successful preflight, when artifacts are produced, then required binaries have size/hash/path ownership recorded and token state is `pending`.
- Given compile failure, missing/empty/deleted/modified artifact, invalid ownership, or cleanup failure that leaves unsafe state, when preflight or execute validates, then result is blocked/invalidated and no flash occurs.

### REQ-005: Destructive execution is fail-closed

The destructive MCP tool MUST be absent unless trusted runtime capabilities report mandatory human approval from a trusted host adapter; arguments MUST NOT set this.

- Given capability is missing, errored, false, or untrusted, when tools register, then `robot_probe` is not registered and the alternative is `pnpm robot:probe`.
- Given approval-like args, when registration/execution runs, then destructive capability still depends only on trusted runtime state.

### REQ-006: MCP and CLI share one safe pipeline

The CLI fallback MUST use the same detection, fingerprinting, artifact hashing, no-recompile reuse, revalidation, strict esptool outcome, cancellation policy, storage/cleanup rules, and split report contract as MCP.

- Given unapproved host and TTY CLI, when operator confirms typed warning, then CLI may execute only through the shared pipeline.
- Given non-TTY CLI, omitted confirmation, or kill-switch disabled path, when invoked, then flash is rejected.

### REQ-007: Tokens are single-use and terminal after start

Tokens MUST transition atomically and never return to `pending` once execution starts.

- Given `pending`, when execution starts, then state becomes `executing` atomically.
- Given post-start revalidation failure, interruption, process failure, serial failure, or cancellation outcome, then state becomes `invalidated` or `consumed` terminally and is never reusable.
- Given expired pending token, when used, then execution is rejected and state is `expired`.

### REQ-008: Flash/probe reports are split and evidence-based

Reports MUST separate flash from probe and MUST NOT claim health.

- Given flash succeeds but probe times out, then `flash.status="completed"`, `probe.status="timeout"`, `diagnosticConclusion="not_available"`.
- Given serial subsystem failure after flash, then `flash.status="completed"`, `probe.status="serial_error"`.
- Given interrupted flash, then `flash.status="interrupted"`, `probe.status="not_started"|"serial_error"`, and token state is `invalidated`.
- Given normal cancel after flash starts, then esptool is not killed by that path and reaches a real terminal outcome.
