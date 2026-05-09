// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library LibVaults {
    // BUG: copy-pasted namespace from LibStrategies — keccak256 hashes match,
    // so writes to LibVaults.layout() corrupt LibStrategies.layout().
    bytes32 internal constant POSITION = keccak256("blok.strategies");

    struct Layout {
        address vault;
        uint256 fee;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = POSITION;
        assembly {
            l.slot := slot
        }
    }
}
