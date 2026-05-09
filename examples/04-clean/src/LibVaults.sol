// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library LibVaults {
    bytes32 internal constant POSITION = keccak256("clean.example.vaults");

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
