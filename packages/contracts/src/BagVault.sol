// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * BagVault — holds the USDC of one mandate tree.
 *
 * - deposit: anyone can fund the vault (the operator, or the dev faucet).
 * - reserve/release: the enforcer (platform treasury signer) locks funds for a
 *   pending purchase; locked funds cannot be withdrawn.
 * - charge: the enforcer moves locked funds to a payee (called by BagMandate).
 * - withdraw: the OPERATOR removes AVAILABLE funds (never reserved).
 */
contract BagVault {
    IERC20Minimal public immutable usdc;
    address public immutable operator;
    address public immutable enforcer;

    address public mandate;
    uint256 public locked;

    error Unauthorized();
    error InsufficientAvailable(uint256 available, uint256 amount);

    constructor(address usdc_, address operator_, address enforcer_) {
        usdc = IERC20Minimal(usdc_);
        operator = operator_;
        enforcer = enforcer_;
    }

    modifier onlyEnforcer() {
        if (msg.sender != enforcer) revert Unauthorized();
        _;
    }

    function setMandate(address mandate_) external onlyEnforcer {
        mandate = mandate_;
    }

    function deposit(uint256 amount) external {
        require(usdc.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
    }

    function available() public view returns (uint256) {
        return usdc.balanceOf(address(this)) - locked;
    }

    function reserve(uint256 amount) external onlyEnforcer {
        if (amount > available()) revert InsufficientAvailable(available(), amount);
        locked += amount;
    }

    function release(uint256 amount) external onlyEnforcer {
        locked -= amount;
    }

    function charge(address payee, uint256 amount) external {
        if (msg.sender != enforcer && msg.sender != mandate) revert Unauthorized();
        locked -= amount;
        require(usdc.transfer(payee, amount), "transfer failed");
    }

    function withdraw(uint256 amount, address to) external {
        if (msg.sender != operator) revert Unauthorized();
        if (amount > available()) revert InsufficientAvailable(available(), amount);
        require(usdc.transfer(to, amount), "transfer failed");
    }
}