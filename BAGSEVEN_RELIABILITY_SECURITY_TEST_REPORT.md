# Bagseven Reliability and Security Test Report

Audit date: 2026-10-14

Scope: repository tests and safe local checks only. No mainnet, real payment, contract deployment, or live Polygon Amoy payment was executed. No private key, API key, or token is included in this report.

## Executive summary

The core TypeScript unit tests, x402 validation tests, provider fixture tests, MCP configuration tests, type checks, and the offline Foundry suite were executed. The important result is mixed:

- The off-chain x402 and MCP configuration tests pass.
- The provider fixture tests pass.
- The offline contract suite runs, but 2 of 17 tests fail because the test expectations do not match the contract's current check ordering.
- The full service E2E flow is blocked because PostgreSQL/Redis and the local HTTP services were not available. No payment result or transaction hash can therefore be claimed.
- The repository has material reliability gaps: child rows are inserted before chain registration, reservations have no `execution_submitted`/`unknown`/`settlement_pending` states, and there is no confirmed background reconciliation worker.
- The production build can pass when run sequentially, but the root parallel test command hit a Next.js build-lock collision. Root lint has a real `preserve-caught-error` failure in the research demo.

Release recommendation: **not ready for production**. It is suitable for continued local testnet development after the contract test mismatch and reliability gaps are addressed.

## Baseline test results

| Area | Command | Result | Evidence |
|---|---|---:|---|
| Solidity contract tests | `forge test --offline -vv` from `packages/contracts` | **FAIL**: 15 passed, 2 failed, 17 total | `packages/contracts/test/BagMandate.t.sol` |
| MCP config | `pnpm test:mcp-config` | **PASS**: 3 tests | `scripts/mcp-config.test.ts` |
| Daemon/x402 | `pnpm --filter @bagseven/daemon test` | **PASS**: 10 tests | `services/daemon/src/x402.test.ts`, `x402-payer.test.ts` |
| Money | `pnpm --filter @bagseven/money test` | **PASS**: 2 tests | `packages/money/src/index.test.ts` |
| Research provider | `pnpm --filter @bagseven/research-provider test` | **PASS**: 2 tests | `services/research-provider/src/index.test.ts` |
| Empty test suites | onchain/server/policy/gateway/db/research-demo package tests | **PASS WITH NO TESTS** | No test files in those packages |
| TypeScript checks | package and app typecheck commands | **PASS** | onchain, console, policy, daemon, gateway, research-demo |
| Console production build | `pnpm --filter @bagseven/onchain build && pnpm --filter @bagseven/console exec next build --webpack` | **PASS WITH WARNINGS** | Optional MetaMask/pino dependencies and an `ox` critical-dependency warning |
| Root test | `pnpm test` | **FAILURE OF TEST RUNNER** | Parallel Turbo tasks collided on an existing Next build lock; targeted tests passed separately |
| Root lint | `pnpm lint` | **FAIL** | `apps/research-demo/src/agent.ts:72` violates `preserve-caught-error` |

### Contract failures

1. `testRevokeBlocksExecute()` expects `MandateInactive()`, but `execute(..., workerId = 0)` reaches `checkWorker()` first and returns `WorkerInactive()` for the unknown worker. This is either a stale test input or a contract error-priority decision that must be made explicit.
2. `testWorkerAllocationAndAncestorAccounting()` expects `WorkerAllocationExceeded()` for a 51 USDC request, but the contract checks the 1 USDC per-purchase cap before worker allocation and correctly returns `PerTxCapExceeded()` under its current ordering. The test must use an amount within the per-purchase cap if it intends to isolate allocation behavior.

These are not safe to silently “fix” in production code. The expected precedence and test fixtures must be agreed and then covered with regression tests.

## Database and blockchain consistency

### Tested by execution

No database/chain integration test could run. Docker was unavailable and Redis was unreachable; ports 4000, 4001, 4003, and 4009 were not serving during the check. The Polygon-oriented scripts were not run because they submit transactions and require the complete local dependency stack.

### Source-level findings

| Scenario | Status | Finding |
|---|---|---|
| DB insert + successful worker registration | **PARTIAL** | `POST /v1/mandates/:id/spawn-agent` inserts the `agents` row, then calls `registerWorker()` in `services/policy/src/routes.ts`. |
| DB insert + chain registration revert | **FAILURE RISK** | The route returns `WORKER_CHAIN_REGISTRATION_FAILED`, but no compensating delete or pending state is visible. A false active DB row can remain. |
| Submitted transaction with missing receipt | **NOT IMPLEMENTED** | No durable worker-registration transaction state or receipt reconciliation was found. |
| Chain succeeds, process crashes before DB update | **NOT IMPLEMENTED** | No registration outbox/reconciler was found. |
| Duplicate child request | **PARTIAL** | HTTP idempotency exists when the caller supplies an idempotency key, but the child route has no visible logical-child unique key or mandatory idempotency protocol. |
| Concurrent same child | **NOT TESTED / UNSAFE BY DESIGN** | No database uniqueness or chain-safe request identity was found for the logical child operation. |
| DB-only worker | **NOT RECONCILED** | `agents` is used for resolution; no automatic check repairs a row missing on-chain. |
| Chain-only worker | **NOT RECONCILED** | The database does not discover all workers from chain events. |

The database schema confirms the gap: `reservation_status` is only `reserved`, `committed`, `settled`, and `released`; there are no registration state fields or transaction receipt/status fields.

## Failed payments and reservation recovery

### Existing automated evidence

The daemon x402 unit tests pass for valid requirements, unsupported networks, invalid recipients, excessive amounts, insufficient window, replay-key stability, failed settlement classification, and pending settlement classification. The payer tests pass for EIP-3009 header construction and invalid chain configuration.

### Missing or unsafe recovery behavior

| Scenario | Status | Finding |
|---|---|---|
| Executor fails before submit | **PARTIAL** | Daemon attempts `/release`; release failure is swallowed. No durable retry queue is visible. |
| Receipt temporarily unavailable | **NOT IMPLEMENTED** | `execute()` returns a hash, but no persisted `execution_submitted` state or receipt poller was found. |
| Transaction reverts | **PARTIAL** | The daemon releases the reservation, but outcome classification is not durable when the chain/RPC result is ambiguous. |
| Chain succeeds, DB unavailable before settle | **FAILURE RISK** | On-chain success can coexist with a still-reserved row; no reconciliation worker was confirmed. |
| Redis unavailable | **NOT TESTED** | Nonce/idempotency/reservation paths depend on Redis; no degraded-mode safety test exists. |
| Provider error before payment | **IMPLEMENTED** | Provider request is made before the spend flow. |
| Provider timeout after payment | **PARTIAL** | x402 attempts refund and release, but there is no durable state machine for unknown provider/facilitator outcome. |
| Refund failure/unknown | **PARTIAL** | Refund is attempted, but there is no separate refund ledger/state in the schema. |
| Reservation expiration | **NOT IMPLEMENTED** | `expires_at` is stored, but no reservation-expiry worker was found. |
| Concurrent budget consumption | **CONTRACT SAFE, OFF-CHAIN PARTIAL** | Final contract checks are authoritative; reservations alone do not provide durable cross-request recovery. |
| Retry after timeout | **PARTIAL** | API idempotency exists when a key is supplied; payment settlement does not have an end-to-end transaction identity state machine. |

Critical recommendation: add `execution_submitted`, `settlement_pending`, and `unknown` states, persist transaction hashes before waiting for settlement, and reconcile chain receipts/events before releasing or reusing a reservation.

## Agent-tree and spending-limit security

### Executed evidence

The offline contract suite passed the following protections: per-transaction cap, daily/window cap, lifetime cap, seller cap, vault insufficiency, enforcer-only execution, owner withdrawal authorization, worker depth, window reset, and fuzz invariant checks. The two allocation/revocation tests failed as described above, so those specific expectations are not fully verified.

### Source-confirmed protections

`BagMandate.sol` re-checks worker activity, global caps, vault balance, and every ancestor allocation inside `execute()`. `registerWorker()` is enforcer-only and validates parent activity, depth, and remaining parent allocation. Policy also verifies owner signatures for child creation and operator EIP-712 signatures for spending.

### Not executed

The following were not run against a local chain/service fixture: cross-mandate parent registration, concurrent child spending, unauthorized worker deactivation, replayed policy nonces through Redis, and a full root/child/grandchild HTTP flow. `scripts/e2e-tree.ts` exists, but requires PostgreSQL, Redis, gateway/policy/daemon processes, a funded test chain, and sends testnet transactions; those prerequisites were not available.

## MCP authentication and tenant isolation

| Check | Result | Evidence |
|---|---|---|
| Required worker binding | **IMPLEMENTED** | `scripts/bagseven-mcp.ts` refuses startup when `BAGSEVEN_MCP_WORKER` is absent. |
| Worker selected by tool argument | **PASS BY DESIGN** | Tool schemas do not expose a worker selector; the process-level binding is used for every daemon path. |
| Local transport/config shape | **PASS** | `scripts/mcp-config.test.ts` passed 3 tests. |
| HTTP auth | **IMPLEMENTED, NOT EXECUTED** | `MCP_AUTH_TOKEN` is checked for HTTP POST; no service was running for an authenticated/unauthenticated request test. |
| Missing credentials / revoked credentials | **NOT TESTED** | No running MCP and no tenant/auth fixture. |
| Remote multi-tenant isolation | **NOT IMPLEMENTED** | No OAuth, hosted MCP identity, or tenant provisioning layer was found. |
| Internal daemon endpoint exposure | **PARTIAL** | Daemon checks `DAEMON_AUTH_TOKEN` when configured; a network-level deployment test was not run. |
| Tool argument validation | **IMPLEMENTED, NOT FULLY TESTED** | Zod schemas exist; no comprehensive MCP invalid-argument test suite was found. |

The local MCP health endpoint is not proof of authorization: it reports process health and worker binding, while payment authorization remains in daemon, policy, and contract layers.

## Key-management findings

The code separates these roles:

- owner key: mandate/spawn/withdraw owner signatures;
- worker operator key: EIP-712 spend intent;
- executor/enforcer key: on-chain `execute()` and worker registration;
- x402 payer key: isolated EIP-3009 payer EOA.

The passing MCP configuration tests verify generated configuration does not contain key/token/secret fields. The research demo receives tool schemas and results, not private keys. The daemon and policy source use server-side environment configuration for signing.

Findings:

- **PASS at unit/config level:** generated MCP configuration excludes secrets.
- **NOT TESTED:** log/HTTP redaction under every exception path.
- **NOT IMPLEMENTED:** KMS/HSM/MPC custody, rotation, revocation, and production managed signing.
- **FAILURE RISK:** local development configuration allows role reuse; separate role addresses are not enforced globally by a startup invariant. The executor must match the contract enforcer, and the operator must match the selected worker, but an automated “all roles distinct” production guard was not found.
- **SAFE FAIL-CLOSED BEHAVIOR:** x402 payer rejects configurations that reuse the worker operator or contract enforcer; the vault is not treated as an EIP-3009 payer.

## x402 results

The x402 unit tests pass for:

- official v2 `PAYMENT-REQUIRED` decoding;
- exact Polygon Amoy and configured USDC selection;
- unsupported network rejection;
- invalid recipient rejection;
- per-purchase and window policy rejection;
- duplicate challenge key generation;
- failed versus pending versus settled classification;
- isolated payer EIP-3009 signature construction;
- invalid payer chain rejection;
- explicit vault EIP-3009 unsupported fail-closed behavior.

Real provider/facilitator settlement was intentionally **not executed**. The current design uses a separately funded payer EOA and a BagMandate vault spend; those are separate events and are not atomic. Provider rejection, refund failure, payer balance failure, and provider settlement/Bagseven record mismatch remain integration scenarios without a live fixture test.

## MCP and full E2E execution status

`curl` checks to local policy, daemon, and MCP ports failed because those services were not running. Redis also could not be reached, and Docker access to the compose socket was unavailable. Consequently:

- `bagseven_status` over a live MCP session: **BLOCKED**;
- `bagseven_search` over a live MCP session: **BLOCKED**;
- permitted `bagseven_fetch`: **BLOCKED**;
- denied `bagseven_fetch`: **BLOCKED**;
- duplicate MCP fetch/no double payment: **BLOCKED**;
- live reservation/settlement/transaction verification: **BLOCKED**;
- Polygon Amoy transaction hash: **NOT PRODUCED**.

The existing `scripts/mcp-smoke.ts` can exercise status and search and can optionally fetch/repeat a paid URL, but it only becomes an end-to-end test after the local services, database, Redis, MCP, worker, mandate, and test provider are running.

## Confirmed defects and recommended fixes

### Critical before production

1. Introduce durable reservation state transitions and a reconciler for chain receipts, provider settlement, refunds, and expired reservations.
2. Make child registration transactional from the application's perspective: create a pending row/outbox, register on-chain, verify the receipt, then activate the row; reconcile unknown outcomes.
3. Add authenticated tenant/owner identity before any hosted or multi-user deployment. The current local worker binding is not a multi-tenant identity system.
4. Move all signing roles to managed custody and add startup checks for configured address/key relationships and role separation.
5. Add integration tests that verify database records, contract events, reservation state, and provider response together.

### High priority for the current local release

1. Resolve the two Foundry test mismatches without weakening contract checks.
2. Add policy route tests; the policy, gateway, DB, and research-demo packages currently report no unit tests.
3. Fix the research-demo lint error at `apps/research-demo/src/agent.ts:72`.
4. Add MCP HTTP authentication and invalid-argument tests using an in-process server.
5. Add tests for executor mismatch, operator mismatch, mandate inactivity, nonce replay, and Redis failure.

## Reproduction commands

Run from the repository root:

```bash
forge test --offline -vv --root packages/contracts
pnpm test:mcp-config
pnpm --filter @bagseven/daemon test
pnpm --filter @bagseven/research-provider test
pnpm --filter @bagseven/money test
pnpm --filter @bagseven/console typecheck
pnpm --filter @bagseven/policy typecheck
pnpm --filter @bagseven/daemon typecheck
pnpm --filter @bagseven/gateway typecheck
pnpm --filter @bagseven/research-demo typecheck
pnpm --filter @bagseven/onchain build
pnpm --filter @bagseven/console exec next build --webpack
```

After PostgreSQL, Redis, policy, daemon, gateway, provider, and a worker-bound MCP are running in a dedicated test environment:

```bash
pnpm exec tsx scripts/mcp-smoke.ts
MCP_SMOKE_PAID_URL=http://127.0.0.1:4010/v1/resources/<id> MCP_SMOKE_REPEAT=true pnpm exec tsx scripts/mcp-smoke.ts
pnpm exec tsx scripts/e2e-tree.ts
```

The last two commands are intentionally not claimed as run here because they can submit testnet transactions and their prerequisites were unavailable.

## Final assessment

**Current state: INCONCLUSIVE for full E2E and NOT READY for production.** The cryptographic parsing, basic contract bounds, MCP binding, and configuration safety have meaningful passing unit evidence. The central reliability question—what happens across a chain submission, process crash, database outage, provider timeout, refund, and retry—is not proven and is not fully implemented. The next test run should use an isolated Anvil/PostgreSQL/Redis fixture and should first add durable state/reconciliation coverage before any live Polygon Amoy payment test.
