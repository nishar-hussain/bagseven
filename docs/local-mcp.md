# Local custom-agent MCP setup

This is the Stage 1 local flow. It uses the existing MCP server, daemon,
policy service, BagMandate contract, and research demo.

## 1. Prepare the platform

Start PostgreSQL and Redis, apply the database migrations, and start the
gateway, policy service, daemon, and console using the repository's existing
development commands. The mandate must be active and its Polygon Amoy vault
must contain test USDC.

The policy service and daemon must use the same chain, contract, and internal
authorization configuration. Configure `DAEMON_EXECUTOR_KEY` and
`DAEMON_EXECUTOR_ADDRESS` once. The policy service now accepts that same
executor key; `ENFORCER_DEV_KEY` and `OWNER_DEV_KEY` remain supported only as
legacy aliases for older local environments.

## 2. Select a worker in the console

Open the Agents page, select an active worker, and use **Connect your custom
agent**. The generated configuration contains only:

- `BAGSEVEN_MCP_WORKER`;
- `BAGSEVEN_MCP_PORT`;
- `DAEMON_URL`.

It never contains an operator private key, executor key, x402 payer key, or
internal service token.

## 3. Start the worker-bound MCP

Run the generated equivalent from the repository root:

```bash
BAGSEVEN_MCP_WORKER=<selected-worker-id> \
BAGSEVEN_MCP_PORT=4009 \
DAEMON_URL=http://127.0.0.1:4001 \
pnpm bagseven-mcp
```

If `MCP_AUTH_TOKEN` or `DAEMON_AUTH_TOKEN` is enabled in the local environment,
keep those values in the local process environment. Do not paste them into an
AI-agent prompt or browser configuration.

## 4. Validate the connection

Click **Test connection** in the console. It verifies:

1. the selected worker resolves through the policy service;
2. the worker is active;
3. its mandate is active;
4. the vault has available USDC;
5. the local MCP health endpoint is reachable;
6. the MCP process reports the same selected worker ID.

## 5. Run the real custom agent

The research demo uses the official MCP TypeScript client and a real
OpenAI-compatible model. Configure the model API key and model settings in
the local environment, then run:

```bash
BAGSEVEN_MCP_URL=http://127.0.0.1:4009/v1/mcp \
pnpm research-demo
```

For the complete local demo, use the existing command after MCP is running:

```bash
pnpm demo:research
```

The agent calls `bagseven_status`, then `bagseven_search`, and only calls
`bagseven_fetch` when the model chooses a resource. A refusal or provider
failure is reported as a failure; the agent does not retry a failed payment.

## 6. Verify a payment

Use a Polygon Amoy provider resource and confirm the result contains the
daemon's decision, reservation information, and transaction hash. Verify the
same transaction on the Polygon Amoy explorer and inspect the reservation and
transaction rows in PostgreSQL. A successful natural-language answer alone is
not proof of settlement.

To test denial, use a resource whose amount is above the worker's per-purchase
limit or available budget. The expected result is a policy refusal and no
settlement transaction.

## 7. Run the deterministic MCP smoke test

For tool-order testing without an LLM, use the real MCP TypeScript client:

```bash
pnpm mcp:smoke
```

This always calls `bagseven_status` and `bagseven_search`. It only calls
`bagseven_fetch` when explicitly enabled:

```bash
MCP_SMOKE_PAID_URL=https://provider.example/paid-resource \
MCP_SMOKE_REPEAT=true \
pnpm mcp:smoke
```

Set `MCP_SMOKE_BLOCKED_URL` as well to exercise a denied resource. The command
prints the raw MCP results, including any decision, reservation ID, and
transaction hash returned by the daemon. It does not fabricate a provider,
payment, or success result.
