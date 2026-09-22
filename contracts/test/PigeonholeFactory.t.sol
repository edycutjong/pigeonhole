// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/PigeonholeFactory.sol";

contract PigeonholeFactoryTest is Test {
    PigeonholeFactory factory;
    address constant TREASURY = address(0xA8965A47c9b6ed34F47B374f36cF6c752D24852a);

    event Swept(bytes32 indexed salt, address indexed pigeonhole, uint256 amount);

    function setUp() public {
        factory = new PigeonholeFactory(TREASURY);
    }

    // --- construction ---

    function test_treasury_set() public view {
        assertEq(factory.treasury(), TREASURY);
    }

    function test_constructor_rejects_zero_treasury() public {
        vm.expectRevert(bytes("treasury=0"));
        new PigeonholeFactory(address(0));
    }

    function test_initCode_shape() public view {
        bytes memory ic = factory.initCode();
        assertEq(ic.length, 22, "22 bytes");
        assertEq(uint8(ic[0]), 0x73, "PUSH20");
        assertEq(uint8(ic[21]), 0xff, "SELFDESTRUCT");
        // bytes 1..20 == treasury
        address embedded;
        assembly { embedded := shr(96, mload(add(ic, 0x21))) }
        assertEq(embedded, TREASURY, "treasury embedded");
    }

    // --- prediction formula (I3: address is a pure function of factory, salt, treasury) ---

    function test_predict_matches_create2_formula() public view {
        bytes32 salt = keccak256("invoice-1");
        address expected = address(uint160(uint256(keccak256(
            abi.encodePacked(hex"ff", address(factory), salt, keccak256(factory.initCode()))
        ))));
        assertEq(factory.predict(salt), expected);
    }

    function test_predict_deterministic() public view {
        bytes32 salt = keccak256("invoice-2");
        assertEq(factory.predict(salt), factory.predict(salt));
    }

    function test_predict_differs_by_salt() public view {
        assertTrue(factory.predict(keccak256("a")) != factory.predict(keccak256("b")));
    }

    function test_predict_differs_by_treasury() public {
        // I3: a different treasury yields a different init-code hash → a different address.
        PigeonholeFactory other = new PigeonholeFactory(address(0xdead));
        bytes32 salt = keccak256("invoice-1");
        assertTrue(factory.predict(salt) != other.predict(salt), "treasury changes the address");
    }

    // --- sweep: the core mechanism (same-tx create + SELFDESTRUCT) ---

    function test_sweep_moves_balance_to_treasury() public {
        bytes32 salt = keccak256("pay-me");
        address p = factory.predict(salt);
        vm.deal(p, 1 ether);
        uint256 t0 = TREASURY.balance;

        vm.expectEmit(true, true, false, true, address(factory));
        emit Swept(salt, p, 1 ether);
        address swept = factory.sweep(salt);

        assertEq(swept, p, "returns predicted address");
        assertEq(TREASURY.balance, t0 + 1 ether, "treasury credited");
        assertEq(p.balance, 0, "pigeonhole drained");
        assertEq(p.code.length, 0, "I1: no runtime code at the address (the EIP-6780 delete itself is proven on mainnet, DEMO.md)");
    }

    function test_sweep_empty_is_noop_with_zero_amount() public {
        bytes32 salt = keccak256("never-paid");
        address p = factory.predict(salt);
        vm.expectEmit(true, true, false, true, address(factory));
        emit Swept(salt, p, 0);
        factory.sweep(salt);
        assertEq(p.balance, 0);
        assertEq(p.code.length, 0);
    }

    function test_sweep_returns_predicted() public {
        bytes32 salt = keccak256("x");
        assertEq(factory.sweep(salt), factory.predict(salt));
    }

    // --- sweepMany ---

    function test_sweepMany_moves_all() public {
        bytes32[] memory salts = new bytes32[](3);
        salts[0] = keccak256("a"); salts[1] = keccak256("b"); salts[2] = keccak256("c");
        uint256 t0 = TREASURY.balance;
        for (uint256 i; i < 3; ++i) vm.deal(factory.predict(salts[i]), 0.5 ether);
        factory.sweepMany(salts);
        assertEq(TREASURY.balance, t0 + 1.5 ether);
        for (uint256 i; i < 3; ++i) assertEq(factory.predict(salts[i]).balance, 0);
    }

    /// Milestone 1 (README): the marginal cost of one more address in a batch is well under a standalone sweep.
    /// Mainnet rows (bench/many.json) are the judged numbers; this pins the shape so a regression in sweepMany shows up locally.
    function test_sweepMany_marginal_gas_below_single_sweep() public {
        uint256 g1 = _sweepManyGas(1);
        uint256 g10 = _sweepManyGas(10);
        uint256 g50 = _sweepManyGas(50);
        uint256 marginal = (g50 - g10) / 40;
        assertLt(marginal, g1, "one more address in a batch must cost less than a whole sweep");
        assertLt(g50, 50 * g1, "50 in one tx must cost less than 50 separate sweeps");
        assertGt(g50, g10);
    }

    function _sweepManyGas(uint256 n) internal returns (uint256 gas) {
        bytes32[] memory salts = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            salts[i] = keccak256(abi.encodePacked("many", n, i));
            vm.deal(factory.predict(salts[i]), 1e12);
        }
        uint256 t0 = TREASURY.balance;
        uint256 g0 = gasleft();
        factory.sweepMany(salts);
        gas = g0 - gasleft();
        assertEq(TREASURY.balance, t0 + n * 1e12);
    }

    // --- fuzz: any salt predicts an address that sweeps cleanly ---

    function testFuzz_predict_then_sweep(bytes32 salt, uint96 amount) public {
        vm.assume(amount > 0);
        address p = factory.predict(salt);
        vm.deal(p, amount);
        uint256 t0 = TREASURY.balance;
        factory.sweep(salt);
        assertEq(TREASURY.balance, t0 + amount);
        assertEq(p.balance, 0);
        assertEq(p.code.length, 0);
    }

    // --- the one revert sweep() can produce: a CREATE2 collision ---

    /// CREATE2 fails (returns address(0)) when the target already has code or a nonce, so the deployed address
    /// cannot equal predict(salt) and the factory refuses to emit a Swept it did not perform. Only reachable if
    /// something else already lives at the predicted address; on chain a pigeonhole never keeps code (EIP-6780).
    function test_sweep_reverts_Create2Mismatch_when_predicted_address_has_code() public {
        bytes32 salt = keccak256("collision");
        address expected = factory.predict(salt);
        vm.etch(expected, hex"00");
        vm.deal(expected, 1 ether);
        uint256 t0 = TREASURY.balance;
        vm.expectRevert(abi.encodeWithSelector(PigeonholeFactory.Create2Mismatch.selector, expected, address(0)));
        factory.sweep(salt);
        assertEq(TREASURY.balance, t0, "nothing moved");
        assertEq(expected.balance, 1 ether, "the balance stayed where it was");
    }

    // NB: re-pay + re-sweep of the SAME address is a cross-tx property (EIP-6780 deletes at tx end).
    // A Foundry test runs in one tx, so the re-pay-after-delete path is proven on mainnet only (DEMO.md re-pay/re-sweep rows).
}
