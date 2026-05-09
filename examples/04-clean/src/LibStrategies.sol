// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library LibStrategies {
    bytes32 internal constant POSITION = keccak256("clean.example.strategies");

    struct Layout {
        uint256 totalAssets;
        address curator;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = POSITION;
        assembly {
            l.slot := slot
        }
    }
}
