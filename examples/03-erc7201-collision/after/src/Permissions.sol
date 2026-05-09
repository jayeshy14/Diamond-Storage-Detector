// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Permissions {
    /// @custom:storage-location erc7201:myapp.storage.permissions
    struct PermissionsStorage {
        mapping(bytes32 => uint256) limit;
    }
}
