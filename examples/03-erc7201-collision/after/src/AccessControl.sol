// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AccessControl {
    /// @custom:storage-location erc7201:myapp.storage.access
    struct AccessStorage {
        mapping(bytes32 => bool) hasRole;
    }
}
