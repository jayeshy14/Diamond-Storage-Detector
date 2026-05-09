// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// "Old" version of the AppStorage library — predates the addition of `paused`.
library LibAppStorage {
    struct AppStorage {
        uint256 totalAssets;
        address curator;
    }
}
