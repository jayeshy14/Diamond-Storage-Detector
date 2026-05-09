// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Single canonical AppStorage definition — both facets import this same file.
library LibAppStorage {
    struct AppStorage {
        uint256 totalAssets;
        bool paused;
        address curator;
    }
}
