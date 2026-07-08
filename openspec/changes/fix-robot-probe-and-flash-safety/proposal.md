# Proposal — fix-robot-probe-and-flash-safety

## Change

Remove false health claims from the Acebott harness and prevent accidental firmware overwrite by requiring safe device targeting, frozen artifacts, and explicit human approval before any destructive flash.

## Motivation

The current path has two high-risk failures: `robot_health` can imply success without evidence of robot health, and flash execution can auto-select a port without a trustworthy approval boundary. That can mislead operators and overwrite the wrong device.

## Scope

### In scope

- PR1: replace executable `robot_health` with a non-executable migration stub.
- PR2: add probe terminology, protocol v1, safe detection, fingerprinting, artifact hashing, single-use confirmation, strict esptool outcomes, and split flash/probe reporting.
- Register destructive MCP execution only when trusted runtime capabilities prove mandatory human approval; missing, errored, or untrusted capability states default-deny.
- Provide `pnpm robot:probe` CLI fallback on unapproved hosts, bound to the same detection, fingerprinting, frozen-artifact, revalidation, cancellation, cleanup, and report invariants as MCP.
- Add tests for protocol mismatch, busy/serial errors, token lifecycle, safe targeting, artifact tampering/deletion, cleanup fail-closed behavior, and CLI interaction.

### Out of scope

- New movement/sensor tools beyond probe.
- Linux/Windows support.
- Fleet inventory or automatic flash retries.
- Any claim that the robot is globally healthy.

## Approach

PR1 returns only:

```ts
{ status: "unavailable", reason: "robot_health_was_removed", replacement: "robot_probe_preflight", replacementAvailable: false }
```

PR2 adds `robot_probe_preflight` and, only on approved hosts, `robot_probe`. Preflight detects the target, fingerprints it, compiles once, validates and hashes artifacts, stores a controlled flash plan, and issues a single-use token. Execution atomically consumes the token, revalidates device and artifact hashes, reuses the approved binaries without recompilation, runs esptool with strict terminal outcome handling, then reports flash and probe status separately. Unapproved hosts expose no destructive MCP tool; operators use the interactive CLI fallback.

## Rollback / Kill Switch

Disable destructive execution by forcing trusted capabilities to unavailable/untrusted or removing the `robot:probe` script. Verification: tool registration must omit `robot_probe`, CLI invocation must fail before flash, and existing tokens must not execute. PR2 rollback returns to the PR1 stub plus disabled preflight/execution.

## Success Criteria

- `robot_health` never compiles, flashes, or reports health.
- Ambiguous, busy, invalid, untrusted, unapproved, tampered, deleted, or cleanup-failed conditions block before `write_flash`.
- MCP and CLI paths share the same safe pipeline and report contract.
- Flash success and probe success remain separate; `diagnosticConclusion` is always `"not_available"`.
