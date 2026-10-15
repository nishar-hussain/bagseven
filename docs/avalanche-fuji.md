# Avalanche Fuji testnet

Bagseven supports Avalanche Fuji C-Chain (`43113`) as its only platform
network. All server and console processes must use the Fuji variables below.

Official Fuji values:

- RPC: `https://api.avax-test.network/ext/bc/C/rpc`
- Chain ID: `43113`
- Native gas token: `AVAX`
- Circle test USDC: `0x5425890298aed601595a70AB815c96711a31Bc65`
- Explorer: `https://testnet.snowtrace.io/`

These values are documented by the [Avalanche Builder Hub](https://build.avax.network/academy/blockchain/x402-payment-infrastructure/04-x402-on-avalanche/02-network-setup).

## Configure Bagseven for Fuji

Copy the following values into the local `.env`:

```ini
SUPPORTED_CHAINS=avalanche_fuji
CHAIN_ID=43113
RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
RPC_FALLBACK_URL=https://api.avax-test.network/ext/bc/C/rpc
USDC_ADDRESS=0x5425890298aed601595a70AB815c96711a31Bc65
NEXT_PUBLIC_CHAIN_ID=43113
NEXT_PUBLIC_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
NEXT_PUBLIC_USDC_ADDRESS=0x5425890298aed601595a70AB815c96711a31Bc65
```

Restart the policy, daemon, gateway, console, and MCP processes after changing
the chain. Mandates must be created on Fuji because the chain ID and contract
address are part of the signed and deployed configuration.

## Deploy a Fuji BagMandate

Fund the executor account with Fuji AVAX for gas and the owner/operator setup
accounts as required. Then run:

```bash
DEPLOY_CHAIN_ID=43113 pnpm deploy:bagmandate
```

The command deploys one BagMandate contract and prints its address without
printing private keys. It does not fund the vault or create the database
mandate row. The normal console mandate-creation flow is preferred because it
deploys and records the mandate together. The script is useful for verifying
the contract bytecode and Fuji signer configuration independently.

## x402 note

The x402 parser and isolated payer accept the Fuji network identifier
`eip155:43113` and the Fuji USDC address. No real provider payment is implied
by chain support alone.
