// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Permissions {
    /// @custom:storage-location erc7201:myapp.storage.access
    /// BUG: namespace id was copy-pasted from AccessControl. The EIP-7201 hash
    /// formula resolves both to the same slot, so writes here corrupt AccessControl's roles.
    struct PermissionsStorage {
        mapping(bytes32 => uint256) limit;
    }
}
