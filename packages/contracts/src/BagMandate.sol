// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BagVault} from "./BagVault.sol";

/**
 * BagMandate — the immutable spending contract for an agent tree.
 *
 * The operator signs the bounds once (constructor); they cannot be edited.
 * There is no Allow/Deny configuration: `check` returns 0 (within bounds) or a
 * refusal code whenever ANY bound is violated:
 *   1 window budget · 2 lifetime cap · 3 per-purchase · 4 per-seller · 5 depth
 *
 * `attemptAndCommit` re-checks the bounds on-chain and, only when valid,
 * increments window/lifetime/seller counters and charges the vault to the payee
 * in one atomic transaction (a reverted commit settles nothing).
 */
contract BagMandate {
    struct Bounds {
        address operator;
        uint256 budgetPerWindow;
        uint256 windowSeconds;
        uint256 lifetimeCap;
        uint256 perPurchase;
        uint256 perSellerBps; // 10000 = 100% of the window budget
        uint8 maxDepth;
    }

    address public immutable operator;
    uint256 public immutable budgetPerWindow;
    uint256 public immutable windowSeconds;
    uint256 public immutable lifetimeCap;
    uint256 public immutable perPurchase;
    uint256 public immutable perSellerBps; // 10000 = 100% of the window budget
    uint8 public immutable maxDepth;
    BagVault public immutable vault;
    address public immutable enforcer;

    uint256 public windowOpenedAt;
    uint256 public windowSpent;
    uint256 public lifetimeSpent;
    mapping(address => uint256) public sellerSpent;

    error Unauthorized();
    error BoundViolation(uint8 code);

    constructor(
        address operator_,
        uint256 budgetPerWindow_,
        uint256 windowSeconds_,
        uint256 lifetimeCap_,
        uint256 perPurchase_,
        uint256 perSellerBps_,
        uint8 maxDepth_,
        address vault_,
        address enforcer_
    ) {
        operator = operator_;
        budgetPerWindow = budgetPerWindow_;
        windowSeconds = windowSeconds_;
        lifetimeCap = lifetimeCap_;
        perPurchase = perPurchase_;
        perSellerBps = perSellerBps_;
        maxDepth = maxDepth_;
        vault = BagVault(vault_);
        enforcer = enforcer_;
        windowOpenedAt = block.timestamp;
    }

    function bounds()
        external
        view
        returns (
            address,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint8
        )
    {
        return (operator, budgetPerWindow, windowSeconds, lifetimeCap, perPurchase, perSellerBps, maxDepth);
    }

    function spendState() public view returns (uint256 currentWindowSpent) {
        if (block.timestamp - windowOpenedAt >= windowSeconds) return 0;
        return windowSpent;
    }

    function check(address, uint256 amount, address seller, uint256 depth) public view returns (uint8 code) {
        uint256 cw = spendState();
        if (amount >= perPurchase) return 3;
        if (depth > maxDepth) return 5;
        if (cw + amount >= budgetPerWindow) return 1;
        if (lifetimeSpent + amount >= lifetimeCap) return 2;
        if (seller != address(0)) {
            uint256 limit = (budgetPerWindow * perSellerBps) / 10000;
            if (sellerSpent[seller] + amount > limit) return 4;
        }
        return 0;
    }

    function attemptAndCommit(address, uint256 amount, address seller, uint256 depth, address payee) external {
        if (msg.sender != enforcer) revert Unauthorized();
        uint8 code = check(msg.sender, amount, seller, depth);
        if (code != 0) revert BoundViolation(code);

        uint256 cw = spendState();
        windowSpent = (block.timestamp - windowOpenedAt >= windowSeconds) ? amount : cw + amount;
        lifetimeSpent += amount;
        if (seller != address(0)) sellerSpent[seller] += amount;
        vault.charge(payee, amount);
    }
}