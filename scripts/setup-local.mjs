/**
 * Sets up the LOCAL faucet (no external testnet faucets needed).
 *
 * Starts a fresh Anvil chain (chain id 11155111, like Sepolia), deploys a mock
 * USDC, mints 1,000,000 USDC to the platform master account (which also holds
 * 10,000 ETH), and points the treasury at it. Funding then works with real local
 * transactions against the Anvil master faucet.
 *
 * Usage:  node scripts/setup-local.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const ANVIL_IMAGE = 'ghcr.io/foundry-rs/foundry:stable';
const MASTER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function sh(cmd) {
  execSync(cmd, { stdio: ['ignore', 'inherit', 'inherit'] });
}

console.log('== 1/3 starting local Anvil (chain 11155111) ==');
try {
  sh('docker rm -f agentos-anvil');
} catch {
  /* not running */
}
sh(`docker run -d --name agentos-anvil -p 8545:8545 ${ANVIL_IMAGE} "anvil --host 0.0.0.0 --chain-id 11155111 --silent"`);
// wait for rpc
for (let i = 0; i < 20; i++) {
  try {
    execSync(`curl -s -o /dev/null -X POST http://localhost:8545 -H "content-type: application/json" --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'`, { stdio: 'ignore' });
    break;
  } catch {
    execSync('sleep 1', { stdio: 'ignore' });
  }
}

console.log('== 2/3 deploying mock USDC + minting to master ==');
let usdc = '';
try {
  usdc = execSync(`MASTER_PRIVATE_KEY=${MASTER_KEY} node scripts/deploy-mock-usdc.mjs`, { encoding: 'utf8' });
} catch (err) {
  console.error('deploy failed — is Docker running?', err.message);
  process.exit(1);
}
const usdcAddress = usdc.match(/MOCK_USDC=(0x[0-9a-fA-F]{40})/)?.[1];
if (!usdcAddress) {
  console.error('could not read mock USDC address');
  process.exit(1);
}
console.log('mock USDC at', usdcAddress);

console.log('== 3/3 pointing the treasury at the local faucet ==');
const envPath = join(root, '.env');
let env = readFileSync(envPath, 'utf8');
const updates = {
  SIGNER_MODE: 'real',
  SEPOLIA_RPC_URL: 'http://localhost:8545',
  SEPOLIA_USDC: usdcAddress,
  TREASURY_MASTER_PRIVATE_KEY: MASTER_KEY,
  TREASURY_AGENT_SEED: env.match(/^TREASURY_AGENT_SEED=(.*)$/m)?.[1] ?? 'local-faucet-seed',
};
const lines = env.split('\n').map((line) => {
  const [key] = line.split('=');
  if (key && key in updates) return `${key}=${updates[key]}`;
  return line;
});
writeFileSync(envPath, lines.join('\n'), 'utf8');

console.log(`\nLocal faucet ready:
  master address : 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  master ETH     : 10,000 (anvil default)
  master USDC    : 1,000,000 (minted)
  USDC contract  : ${usdcAddress}
  RPC            : http://localhost:8545

Restart the treasury, then the console "Credit" and "Reserve & settle" steps run
real local transactions against this faucet:
  pkill -f \"dist/index.js\"; pnpm --filter @agentos/treasury start
`);