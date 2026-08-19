// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Registry
 * @notice On-chain mapping of email/phone hashes to Quai wallet addresses.
 *         Deployed and owned by the Wype custodial backend.
 */
contract Registry {
    address public owner;
    mapping(bytes32 => address) private registry;

    event AddressRegistered(bytes32 indexed emailHash, address walletAddress);
    event AddressUpdated(
        bytes32 indexed emailHash,
        address oldAddress,
        address newAddress
    );

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Registry: caller is not the owner");
        _;
    }

    /**
     * @notice Register or update a wallet address for an email/phone hash.
     * @param emailHash  SHA-256 hash of the lowercase email or phone number.
     * @param walletAddress  The Quai wallet address to map to.
     */
    function register(bytes32 emailHash, address walletAddress)
        external
        onlyOwner
    {
        require(walletAddress != address(0), "Registry: zero address");
        address old = registry[emailHash];
        registry[emailHash] = walletAddress;
        if (old == address(0)) {
            emit AddressRegistered(emailHash, walletAddress);
        } else {
            emit AddressUpdated(emailHash, old, walletAddress);
        }
    }

    /**
     * @notice Resolve an email/phone hash to its registered wallet address.
     * @return The mapped address, or address(0) if not registered.
     */
    function resolve(bytes32 emailHash) external view returns (address) {
        return registry[emailHash];
    }
}
