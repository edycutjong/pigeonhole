// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "../src/PigeonholeFactory.sol";

/// @notice Deploys PigeonholeFactory deterministically. TREASURY is passed explicitly from the
///         environment — never `msg.sender` (in `forge script` msg.sender is Foundry's default
///         sender, not your keystore; that mistake sent 0.01 USDC to the wrong address in the probe).
contract Deploy is Script {
    function run() external {
        address treasury = vm.envAddress("TREASURY");
        // The mainnet factory was deployed with salt 0x…01 through the Arachnid CREATE2 factory via `cast`
        // (forge script rejects CREATE2 on chain 5042 — see docs/DX-REPORT.md). Same salt here so the address matches.
        bytes32 salt = bytes32(uint256(1));
        vm.startBroadcast();
        PigeonholeFactory factory = new PigeonholeFactory{salt: salt}(treasury);
        vm.stopBroadcast();
        console.log("FACTORY", address(factory));
        console.log("TREASURY", factory.treasury());
        console.log("PREDICT(demo-paid)", factory.predict(keccak256("demo-paid")));
    }
}
