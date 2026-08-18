// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {WypeEscrow} from "../src/WypeEscrow.sol";

/**
 * @notice Deploys {WypeEscrow}.
 *
 * Reads:
 *   DEPLOYER_PRIVATE_KEY - funded key that pays for deployment
 *   ESCROW_OWNER         - address allowed to rotate the verifier (defaults to deployer)
 *   ESCROW_VERIFIER      - backend key that signs claims
 *
 * Quai note: contract addresses on Quai must fall inside the deploying zone's
 * address range, which normally requires grinding the deployment nonce. Confirm
 * the resulting address is a Cyprus-1 address before pointing the backend at it;
 * if `forge script` cannot produce one, deploy with quais.js instead — the
 * contract bytecode is unaffected either way.
 */
contract DeployWypeEscrow is Script {
    function run() external returns (WypeEscrow escrow) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address verifier = vm.envAddress("ESCROW_VERIFIER");
        address owner = vm.envOr("ESCROW_OWNER", vm.addr(deployerKey));

        vm.startBroadcast(deployerKey);
        escrow = new WypeEscrow(owner, verifier);
        vm.stopBroadcast();

        console.log("WypeEscrow deployed at:", address(escrow));
        console.log("  owner:   ", owner);
        console.log("  verifier:", verifier);
    }
}
