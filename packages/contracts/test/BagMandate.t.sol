// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BagVault} from "../src/BagVault.sol";
import {BagMandate} from "../src/BagMandate.sol";

contract MockUSDC {
    string public constant name = "Mock USDC";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract BagMandateTest is Test {
    MockUSDC usdc;
    BagVault vault;
    BagMandate mandate;

    address operator = makeAddr("operator");
    address enforcer = makeAddr("enforcer");
    address payee = makeAddr("payee");

    function setUp() public {
        usdc = new MockUSDC();
        vault = new BagVault(address(usdc), operator, enforcer);
        mandate = new BagMandate(
            operator,
            20e6, // $20 / window
            86400, // 24h
            50e6, // $50 lifetime
            5e6, // $5 per purchase
            1000, // 10% per seller = $2
            2, // max depth
            address(vault),
            enforcer
        );
        vm.prank(enforcer);
        vault.setMandate(address(mandate));
    }

    function testFundsVaultAndAvailable() public {
        usdc.mint(operator, 100e6);
        vm.startPrank(operator);
        usdc.approve(address(vault), 100e6);
        vault.deposit(100e6);
        vm.stopPrank();
        assertEq(vault.available(), 100e6);
    }

    function testReserveLocksButWithdrawDoesNot() public {
        usdc.mint(operator, 100e6);
        vm.startPrank(operator);
        usdc.approve(address(vault), 100e6);
        vault.deposit(100e6);
        vm.stopPrank();

        // Reserve $1 — locked, cannot be withdrawn.
        vm.prank(enforcer);
        vault.reserve(1e6);
        assertEq(vault.locked(), 1e6);
        vm.prank(operator);
        vm.expectRevert();
        vault.withdraw(100e6, operator); // available is now 99e6
        vm.prank(operator);
        vault.withdraw(99e6, operator);
        assertEq(usdc.balanceOf(operator), 99e6);
    }

    function testAttemptAndCommitPaysPayeeAndMovesCounters() public {
        usdc.mint(operator, 100e6);
        vm.startPrank(operator);
        usdc.approve(address(vault), 100e6);
        vault.deposit(100e6);
        vm.stopPrank();

        vm.prank(enforcer);
        vault.reserve(1e6);
        vm.prank(enforcer);
        mandate.attemptAndCommit(address(0), 1e6, payee, 0, payee);

        assertEq(usdc.balanceOf(payee), 1e6);
        assertEq(mandate.windowSpent(), 1e6);
        assertEq(mandate.lifetimeSpent(), 1e6);
        assertEq(mandate.sellerSpent(payee), 1e6);
    }

    function testPerPurchaseBoundReverts() public {
        usdc.mint(operator, 100e6);
        vm.startPrank(operator);
        usdc.approve(address(vault), 100e6);
        vault.deposit(100e6);
        vm.stopPrank();

        vm.prank(enforcer);
        vault.reserve(10e6);
        vm.prank(enforcer);
        vm.expectRevert(abi.encodeWithSelector(BagMandate.BoundViolation.selector, 3));
        mandate.attemptAndCommit(address(0), 10e6, payee, 0, payee);
    }

    function testPerSellerBoundEnforced() public {
        usdc.mint(operator, 100e6);
        vm.startPrank(operator);
        usdc.approve(address(vault), 100e6);
        vault.deposit(100e6);
        vm.stopPrank();

        // seller limit = 10% of $20 = $2. Two $1 purchases, then a third reverts.
        for (uint256 i = 0; i < 2; i++) {
            vm.prank(enforcer);
            vault.reserve(1e6);
            vm.prank(enforcer);
            mandate.attemptAndCommit(address(0), 1e6, payee, 0, payee);
        }
        vm.prank(enforcer);
        vault.reserve(1e6);
        vm.prank(enforcer);
        vm.expectRevert(abi.encodeWithSelector(BagMandate.BoundViolation.selector, 4));
        mandate.attemptAndCommit(address(0), 1e6, payee, 0, payee);
    }

    function testNonEnforcerCannotCommit() public {
        vm.prank(operator);
        vm.expectRevert(BagMandate.Unauthorized.selector);
        mandate.attemptAndCommit(address(0), 1e6, payee, 0, payee);
    }
}