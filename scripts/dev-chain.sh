#!/usr/bin/env bash
#
# Start the local Bagseven chain (anvil) and deploy the dev MockUSDC.
# Boots anvil on :8545 if not already running, deploys MockUSDC, mints to the
# standard dev accounts, and writes LOCAL_* settings into .env for the services.
#
# Usage: ./scripts/dev-chain.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${ANVIL_RPC:-http://localhost:8545}"
ACCT0="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ENV_FILE="$ROOT/.env"

if ! curl -s -X POST -H "content-type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' "$RPC" >/dev/null 2>&1; then
  echo "[dev-chain] starting anvil on :8545 ..."
  anvil --silent --port 8545 >/tmp/agentos-logs/anvil.log 2>&1 &
  sleep 3
fi
echo "[dev-chain] chain up at $RPC"

cd "$ROOT/packages/contracts"
OUT="$(PRIVATE_KEY="$ACCT0" forge script script/DeployLocal.s.sol --rpc-url "$RPC" --broadcast 2>&1)"

USDC="$(echo "$OUT" | grep -oE 'MOCK_USDC=0x[0-9a-fA-F]{40}' | head -1 | cut -d= -f2)"
OWNER="$(echo "$OUT" | grep -oE 'OWNER_DEV=0x[0-9a-fA-F]{40}' | head -1 | cut -d= -f2)"
OPERATOR="$(echo "$OUT" | grep -oE 'OPERATOR_DEV=0x[0-9a-fA-F]{40}' | head -1 | cut -d= -f2)"
ENFORCER="$(echo "$OUT" | grep -oE 'ENFORCER_DEV=0x[0-9a-fA-F]{40}' | head -1 | cut -d= -f2)"
[ -n "$USDC" ] || { echo "deploy failed:"; echo "$OUT" | tail -20; exit 1; }
echo "[dev-chain] MockUSDC=$USDC owner=$OWNER operator=$OPERATOR enforcer=$ENFORCER"

set_local() { # set_local KEY VALUE
  if grep -q "^$1=" "$ENV_FILE"; then
    sed -i '' "s#^$1=.*#$1=$2#" "$ENV_FILE"
  else
    echo "$1=$2" >> "$ENV_FILE"
  fi
}
set_local CHAIN_ID 31337
set_local RPC_URL "$RPC"
set_local USDC_ADDRESS "$USDC"
set_local OWNER_DEV_KEY "$ACCT0"
set_local ENFORCER_DEV_KEY "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
set_local OPERATOR_DEV_KEY "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
echo "[dev-chain] .env updated (CHAIN_ID=31337, RPC_URL, USDC_ADDRESS, keys)"