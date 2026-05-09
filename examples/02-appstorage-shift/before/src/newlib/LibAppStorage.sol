// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// "New" version of the AppStorage library — adds `paused` between `totalAssets` and `curator`.
// In a real deployment, this drift would happen because one facet was rebuilt against
// the new struct while another still ships the old layout.
library LibAppStorage {
    struct AppStorage {
        uint256 totalAssets;
        bool paused;
        address curator;
    }
}
