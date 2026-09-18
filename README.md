# AgentOS

Infrastructure for autonomous AI agents: verifiable identity, policy-gated treasury, tool/data marketplaces, agent-to-agent economy, and a sandboxed evolution engine.

> **The LLM proposes. Deterministic code disposes.** The agent can propose any action, but Identity, Policy, and Treasury are deterministic services that approve or deny every spend. No prompt, jailbreak, or hallucination can move money or exceed a budget.

See `docs/DECISIONS.md` for the hard invariants the build encodes (spend_token, delegation accounting, fail-closed, idempotency, ledger, receipts).

## Repository layout

```
apps/console          # Next.js developer console (browser UI for the Phase-1 flows)
services/             # independently deployable services
  gateway/            # single public ingress: envelope auth, rate limit, routing, CORS
  identity/           # agents, orgs, guardians
  policy/             # budgets, limits, delegation, spend_token issuance
  treasury/           # wallets, reservations, co-signing, signer abstraction
  verification/       # append-only receipts, hash chain
  (payments, marketplace-*, directory, evolution)  # later phases
packages/             # shared libraries
  db, money, auth, config, events, server, sdk, testing
contracts/            # Solidity (later phases)
scripts/              # key generation + e2e verification
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
pnpm dev                   # boots all 5 services + the console (Turbo TUI dashboard)
```

Or start pieces individually via `pnpm --filter @agentos/<svc> start`. Services (defaults): gateway `:4000`, identity `:4001`, treasury `:4002`, policy `:4003`, verification `:4004`.

## Console

The browser UI at **http://localhost:3000** walks the full Phase-1 flow in five steps:

1. **Create agent** — org → guardian → agent → guardian confirms to `active`
2. **Wallet & funds** — provision wallet, credit USDC (dev faucet)
3. **Policy** — daily budget, max per tx, category limits, approval threshold
4. **Spend intents** — propose spends: `$500 → deny`, in-limit → `allow` + spend_token, plus an idempotent-retry button
5. **Reserve & settle** — present the token to the treasury, settle, watch balance + receipt

The console signs request envelopes in the browser with WebCrypto (Ed25519) — no private key leaves the page except the agent's signing key shown once at creation. Session state lives in `localStorage`.

To point the console at a different gateway: `NEXT_PUBLIC_GATEWAY_URL=https://… pnpm --filter @agentos/console dev` (default `http://localhost:4000`).

## Verify Phase 1 end-to-end

```bash
pnpm exec tsx scripts/e2e-phase1.ts
```

This runs the full money loop: create org → guardian → agent → guardian confirm → provision wallet → fund → publish policy → over-limit spend **denied** → in-limit spend **allowed + spend_token** → idempotent retry → category-budget denial → reserve → commit → receipt → balance accounting. All checks must print `[PASS]`.

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