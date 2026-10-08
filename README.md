# bagseven

Infrastructure for autonomous AI agents: verifiable identity, policy-gated treasury, tool/data marketplaces, agent-to-agent economy, and a sandboxed evolution engine.

> **The LLM proposes. Deterministic code disposes.** The agent can propose any action, but Identity, Policy, and Treasury are deterministic services that approve or deny every spend. No prompt, jailbreak, or hallucination can move money or exceed a budget.

See `docs/DECISIONS.md` for the hard invariants the build encodes (spend_token, delegation accounting, fail-closed, idempotency, ledger, receipts).

## Repository layout

```
apps/console          # Next.js developer console (browser UI: identity → treasury → marketplace)
services/             # independently deployable services
  gateway/            # single public ingress: envelope auth, rate limit, routing, CORS
  daemon/             # trusted worker between MCP and policy/mandate execution
  identity/           # agents, orgs, guardians
  policy/             # budgets, limits, delegation, spend_token issuance
  treasury/           # wallets, reservations, co-signing, signer abstraction
  verification/       # append-only receipts, hash chain
  marketplace-tools/  # tool registry, discovery, x402-gated execution, MCP (Phase 2)
  payments/           # x402 orchestration (the 402 → pay → retry dance)
  (marketplace-data, directory, evolution)  # later phases
packages/             # shared libraries
  db, money, auth, config, events, server, sdk, testing
contracts/            # Solidity (later phases)
scripts/              # key generation + phase E2E verification
deploy/docker-compose.yml
```

## Prerequisites

- Node.js >= 24, pnpm >= 10
- Docker (for Postgres, Redis/Valkey, Redpanda)

## Setup

```bash
pnpm install
pnpm db:up                 # start postgres + redis + redpanda
pnpm build
pnpm db:generate           # generate migrations from the Drizzle schema
pnpm db:migrate            # apply migrations

# generate the policy signing keypair and write .env
pnpm exec tsx scripts/gen-policy-key.ts
# copy the two POLICY_SIGNING_*_PEM lines into .env (see .env.example)
```

## Run

```bash
pnpm dev                   # boots the workspace services + console
pnpm --filter @bagseven/daemon dev
pnpm bagseven-mcp
```

Or start pieces individually via `pnpm --filter @bagseven/<svc> start`. Services (defaults): gateway `:4000`, daemon `:4001`, policy `:4003`, MCP `:4009`.

## Bagseven daemon and MCP

The MCP server is the agent-facing adapter. It contains no signing or policy logic. Requests flow through the Bagseven daemon:

```text
AI agent → Bagseven MCP → Bagseven daemon → policy service → BagMandate contract → vault
```

Start the daemon and MCP locally:

```bash
pnpm --filter @bagseven/daemon dev
BAGSEVEN_MCP_PORT=4009 pnpm bagseven-mcp
```

The MCP tools are `bagseven_status`, `bagseven_fetch`, and `bagseven_spawn`. The daemon uses `DAEMON_OPERATOR_KEY` and `DAEMON_OWNER_KEY` in development; production must use managed custody such as HSM, MPC, or a smart account.

Each MCP process is bound to exactly one worker. Set `BAGSEVEN_MCP_WORKER` before starting it. Paid providers must be registered in `BAGSEVEN_PROVIDER_KEYS` as a JSON object mapping hostnames to provider signing addresses; the daemon verifies the signed 402 challenge, expiry, chain, token, and nonce before requesting payment.

For durable registration, an administrator can call `POST /v1/providers` with `PROVIDER_ADMIN_TOKEN`; the daemon resolves registered providers through `GET /v1/providers/:hostname` when they are not present in the local configuration.

## Console

The browser UI at **http://localhost:3000** walks the full Phase-1 flow in five steps:

1. **Create agent** — org → guardian → agent → guardian confirms to `active`
2. **Wallet & funds** — provision wallet, credit USDC (dev faucet)
3. **Policy** — daily budget, max per tx, category limits, approval threshold
4. **Spend intents** — propose spends: `$500 → deny`, in-limit → `allow` + spend_token, plus an idempotent-retry button
5. **Reserve & settle** — present the token to the treasury, settle, watch balance + receipt

The console signs request envelopes in the browser with WebCrypto (Ed25519) — no private key leaves the page except the agent's signing key shown once at creation. Session state lives in `localStorage`.

To point the console at a different gateway: `NEXT_PUBLIC_GATEWAY_URL=https://… pnpm --filter @bagseven/console dev` (default `http://localhost:4000`).

## Verify Phase 1 end-to-end

```bash
pnpm exec tsx scripts/e2e-phase1.ts     # full money loop (real signer needs funded master)
pnpm exec tsx scripts/e2e-phase1b.ts    # delegation · approval→token · suspension gate · summary · compensation
```

Both print `[PASS]` per check. `e2e-phase1.ts` runs the core money loop; `e2e-phase1b.ts` covers the remaining Phase-1 features fully off-chain:

- **Delegation** (`POST /v1/agents/:id/delegate`, guardian-authorized): child agent + initial policy created as a **strict subset** of the parent (daily budget < parent nominal AND ≤ parent remaining; max_tx ≤ parent; chains/categories ⊆ parent). Over-budget delegation is rejected at creation (`DELEGATION_SUBSET_VIOLATION`).
- **Guardian approval → token loop** (`POST /v1/guardian-approvals/:id/respond`): an above-threshold spend is `pending_approval`; the guardian approves → budget is re-checked against the *current* policy → the spend_token is minted. Rejection records `deny`, no token.
- **Fail-closed suspension**: the gateway refuses to authenticate a non-`active` agent, and the policy engine additionally denies non-active agents — never an ALLOW.
- **Spend summary** (`GET /v1/agents/:id/spend-summary`): daily/monthly/children spend vs budget + per-category limits.
- **Budget compensation** (`POST /v1/compensations`): a released/failed reservation decrements the counters that were incremented at token issuance — idempotent per decision, so retries can't double-credit.
- **Hard platform cap** (`PLATFORM_MAX_TOTAL_SPEND`): atomic check-and-increment on treasury commit limits cumulative real settlement.
- **Retire + wallet sweep**: `POST /v1/agents/:id/retire` and `POST /v1/wallets/:id/sweep` (real signer transfers the full on-chain USDC + native balance).

## Tests

```bash
pnpm test                  # unit + concurrency suite (requires local Redis for integration tests)
pnpm lint
pnpm typecheck
```

The concurrency suite (`services/policy/src/counters.integration.test.ts`) is the slice-1.8 gate: 1,000 parallel requests against a $100 daily budget must allow exactly 5 × $20, never 6, and two delegated children cannot jointly exceed the parent's remaining budget.

## Key flows

1. Agent proposes a spend → `POST /v1/spend-intents` → Policy evaluates (static rules) + atomic Redis budget gate (Lua) → on ALLOW issues a signed, single-use, 30s-expiry **spend_token** bound to amount/currency/chain/category/counterparty.
2. Treasury co-signs a payment only on presentation of a valid token (`POST /v1/reservations`), then `commit` settles it: debits the payer, credits the payee, writes a hash-chained receipt.
3. Delegation: a child's spend atomically decrements every ancestor's remaining budget (`spend:child:{anc}` counters), so no chain of sub-agents can exceed the parent's cap.

## Phase 2 — Tool Marketplace

A paid tool call runs through the whole Phase-1 pipeline, plus x402:

```
POST /v1/tools/:id/execute  (marketplace-tools)
  → policy spend-intent (tool_id, category, price) → spend_token
  → treasury reserve (counterparty = provider, type tool_provider)
  → payments x402: call provider → 402 challenge {amount,token,chain,payTo,nonce}
      validate (amount = listed price; payTo = provider's REGISTERED payout — else abort)
  → treasury commit → real transfer to registered payout → tx hash
  → retry provider with X-Payment → 200 + result → receipt
```

- **Providers** register (`pending`) then get approved (`active`); tools carry a price, category, and endpoint. Discovery: `GET /v1/tools?category=&max_price=`.
- **PayTo binding (2.6):** the settlement goes to the provider's *registered* payout address, never a challenge-supplied one; a mismatch aborts the payment *before any signature*.
- **MCP:** `http://localhost:4009/v1/mcp` exposes Bagseven control tools to any MCP-compatible agent framework (`tools/list`, `tools/call`).

## AI Research Buyer demo

The isolated research demo lets a user ask a natural-language research question. The agent searches a local research marketplace, requests a paid report through the worker-bound MCP, and summarizes the result. The UI also includes a blocked premium-purchase scenario so mandate enforcement is visible.

Run the existing database, policy, daemon, and worker-bound MCP first. Then start the provider and demo UI together:

```bash
pnpm demo:research
```

Open `http://localhost:4020`, enter a research question, and select either **Run approved research** or **Try blocked purchase**. Configure `OPENAI_API_KEY` for an LLM-generated summary; without it, the demo uses a deterministic local summary while preserving the real MCP/payment flow.

Verify end-to-end (against whatever `SEPOLIA_RPC_URL` points at):
```bash
pnpm exec tsx scripts/e2e-phase2.ts
```
Covers: onboard provider → list tool → paid execution → provider paid exactly the price on-chain → buyer ledger debited → receipt → policy-denied tool → payTo-redirect blocked. 11/11 PASS.

## Real wallets on Base testnet (slice 1.6)

Two signer modes behind the same interface:

| Mode | Addresses | Settlement |
|---|---|---|
| `SIGNER_MODE=dev` (default) | fabricated from a hash | simulated tx hashes |
| `SIGNER_MODE=real` | **real EOA** derived per agent (`sha256(agentSeed:agentId:chain)`) | **real on-chain transactions** (viem) |

In `real` mode the treasury holds a **master account** (`TREASURY_MASTER_PRIVATE_KEY`). The dev faucet credit becomes a real token transfer from master → agent (plus a small native gas grant so the agent can pay its own gas), and commit broadcasts a real ERC-20 `transfer` to the payee's real address.

### Test locally with Anvil (no faucet needed)

```bash
# 1. Run a local EVM chain that mimics Ethereum Sepolia (chain id 11155111)
docker run -d --name bagseven-anvil -p 8545:8545 ghcr.io/foundry-rs/foundry:stable "anvil --host 0.0.0.0 --chain-id 11155111 --silent"

# 2. Deploy a mock USDC + mint to the master account (prints MOCK_USDC + master address)
node scripts/deploy-mock-usdc.mjs

# 3. Point the stack at it
cat >> .env <<'EOF'
SIGNER_MODE=real
TREASURY_AGENT_SEED=local-test-seed
TREASURY_MASTER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
SEPOLIA_RPC_URL=http://localhost:8545
SEPOLIA_USDC=<MOCK_USDC from step 2>
GAS_GRANT_NATIVE=0.01
EOF
# restart the services, then:
pnpm exec tsx scripts/e2e-real.ts
```

`scripts/e2e-real.ts` proves the full flow with real transactions: two agents get real addresses, A is funded 100 USDC on-chain, A commits a $3 payment to B, and the token contract itself shows A=97 / B=3 USDC.

### Local faucet (no external testnet faucets needed)

For local testing, run the whole platform against a local Anvil chain with a
built-in faucet (10,000 ETH + 1,000,000 USDC on the master account) — real EOAs,
real local transactions, zero faucet visits:

```bash
node scripts/setup-local.mjs     # start Anvil + deploy mock USDC + point .env at it
pkill -f "dist/index.js"; for s in gateway daemon policy; do pnpm --filter "@bagseven/$s" start & done
E2E_CREDIT=10 E2E_SPEND=3 pnpm exec tsx scripts/e2e-real.ts   # full real-local E2E
```

Funding in the console then runs real local transactions against the local master
faucet. To go back to real Sepolia, set `SIGNER_MODE=real` with your funded key +
`SEPOLIA_RPC_URL`, or `SIGNER_MODE=dev` for purely simulated settlement.

### Test on real Ethereum Sepolia

1. Create a wallet for the master account and fund it with testnet ETH + USDC:
   - Sepolia faucets: `https://faucet.quicknode.com/ethereum/sepolia`, `https://www.alchemy.com/faucets/ethereum-sepolia` (ETH for gas), and Circle's testnet faucet for USDC.
2. Set `SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com` (or any public Sepolia RPC), `SEPOLIA_USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, and `TREASURY_MASTER_PRIVATE_KEY` to that wallet's key.
3. Restart and run `scripts/e2e-real.ts` — the same code, broadcasting to the real testnet. Verify the tx hashes on the [Sepolia explorer](https://sepolia.etherscan.io).

> Note: `real` mode uses derived software keys (`eoa` custody type). This is correct for testnet and local verification; production custody should swap in MPC/smart-account custody behind the same `Signer` interface — the reservation/policy code does not change.
