/**
 * Deploys a mintable MockUSDC (6 decimals) on a local Anvil instance and mints
 * 1,000,000 USDC to the platform master account. Prints the USDC address.
 *
 * Usage:  node scripts/deploy-mock-usdc.mjs
 */
import solc from 'solc';
import { createPublicClient, createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const RPC = process.env.ANVIL_RPC ?? 'http://localhost:8545';
const MASTER_KEY = process.env.MASTER_PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract MockUSDC {
    string public name = "USD Coin (test)";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }
    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(allowance[from][msg.sender] >= value, "allowance");
        allowance[from][msg.sender] -= value;
        _transfer(from, to, value);
        return true;
    }
    function _transfer(address from, address to, uint256 value) internal {
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
`;

const input = {
  language: 'Solidity',
  sources: { 'MockUSDC.sol': { content: SOURCE } },
  settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};

const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
const contract = compiled.contracts['MockUSDC.sol'].MockUSDC;
if (!contract) {
  console.error('compile failed', JSON.stringify(compiled.errors ?? [], null, 2));
  process.exit(1);
}

const account = privateKeyToAccount(MASTER_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

const hash = await wallet.deployContract({
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
  args: [],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const usdcAddress = receipt.contractAddress;
console.log('MOCK_USDC=' + usdcAddress);

// Mint 1,000,000 USDC to the master account (1e12 in 6 decimals).
const mintTx = await wallet.writeContract({
  address: usdcAddress,
  abi: contract.abi,
  functionName: 'mint',
  args: [account.address, 1_000_000_000_000n],
});
await publicClient.waitForTransactionReceipt({ hash: mintTx });
console.log('MASTER_ADDRESS=' + account.address);
console.log('minted 1,000,000 USDC to master');