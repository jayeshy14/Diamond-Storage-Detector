// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibAppStorage} from "./lib/LibAppStorage.sol";

contract FacetB {
    LibAppStorage.AppStorage internal s;

    function pause() external {
        s.paused = true;
    }
}
