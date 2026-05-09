// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibAppStorage} from "./lib/LibAppStorage.sol";

contract FacetA {
    LibAppStorage.AppStorage internal s;

    function setCurator(address c) external {
        s.curator = c;
    }
}
