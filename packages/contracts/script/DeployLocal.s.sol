// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/**
 * Deploys the dev MockUSDC and mints to the standard anvil accounts:
 *   0 = deployer/faucet · 1 = owner · 2 = operator · 3 = enforcer
 * Usage (anvil running on :8545):
 *   forge script script/DeployLocal.s.sol --rpc-url http://localhost:8545 --broadcast --private-key <acct0>
 */
contract DeployLocal is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        MockUSDC usdc = new MockUSDC();
        address[4] memory recipients = [
            vm.addr(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80),
            vm.addr(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d),
            vm.addr(0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a),
            vm.addr(0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6)
        ];
        for (uint256 i = 0; i < recipients.length; i++) {
            usdc.mint(recipients[i], 1_000_000e6); // $1,000,000 each
        }

        vm.stopBroadcast();

        console2.log("MOCK_USDC=%s", address(usdc));
        console2.log("OWNER_DEV=%s", recipients[1]);
        console2.log("OPERATOR_DEV=%s", recipients[2]);
        console2.log("ENFORCER_DEV=%s", recipients[3]);
    }
}