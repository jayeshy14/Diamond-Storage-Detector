// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Owned {
    /// @custom:storage-location erc7201:clean.example.owned
    struct OwnedStorage {
        address owner;
    }
}
