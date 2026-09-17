// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title PigeonholeFactory
/// @notice A fresh USDC deposit address per invoice, with no private key. A CREATE2-predicted
///         address receives native USDC before any code exists; `sweep` deploys a 22-byte
///         throwaway whose constructor SELFDESTRUCTs to the immutable treasury, moving the
///         native balance in the same transaction (Arc: SELFDESTRUCT is allowed during
///         deployment and moves the native USDC balance, emitting an EIP-7708 Transfer).
/// @dev    Sweeper init-code is `PUSH20 <treasury>; SELFDESTRUCT` = `0x73 ‖ treasury ‖ 0xff`.
///         Because the init-code embeds the immutable treasury, the CREATE2 address is a pure
///         function of (factory, salt, treasury): funds a sweep moves can only ever reach the
///         treasury. EIP-6780 fully deletes the throwaway (same-tx create), so the address
///         returns to code-length 0 / nonce 0 and can receive and be swept again.
contract PigeonholeFactory {
    /// @notice The only destination any swept funds can reach. Set once, never changeable.
    address public immutable treasury;

    /// @notice Emitted after a sweep. `amount` is the native balance moved (18 decimals); 0 for an empty sweep.
    event Swept(bytes32 indexed salt, address indexed pigeonhole, uint256 amount);

    /// @notice The deployed CREATE2 address did not match the predicted one (should be impossible).
    error Create2Mismatch(address expected, address deployed);

    constructor(address _treasury) {
        require(_treasury != address(0), "treasury=0");
        treasury = _treasury;
    }

    /// @notice The sweeper init-code, derived from the immutable treasury.
    function initCode() public view returns (bytes memory) {
        return abi.encodePacked(hex"73", treasury, hex"ff");
    }

    /// @notice The deterministic deposit address for `salt` (offline-reproducible; see src/lib/pigeonhole.ts).
    function predict(bytes32 salt) public view returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(hex"ff", address(this), salt, keccak256(initCode())))))
        );
    }

    /// @notice Sweep the pigeonhole for `salt` to the treasury. Permissionless; funds can only reach `treasury`.
    /// @return deployed The address that was swept (equals `predict(salt)`).
    function sweep(bytes32 salt) public returns (address deployed) {
        address expected = predict(salt);
        uint256 bal = expected.balance;
        bytes memory code = initCode();
        assembly {
            deployed := create2(0, add(code, 0x20), mload(code), salt)
        }
        if (deployed != expected) revert Create2Mismatch(expected, deployed);
        emit Swept(salt, expected, bal);
    }

    /// @notice Sweep many pigeonholes in one transaction.
    function sweepMany(bytes32[] calldata salts) external {
        for (uint256 i; i < salts.length; ++i) {
            sweep(salts[i]);
        }
    }
}
