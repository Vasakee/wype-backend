// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Escrow
 * @notice Holds QUAI in escrow for recipients who haven't claimed yet.
 *         Funds are locked for a configurable duration (default 7 days).
 *         After expiry, the original sender can reverse the escrow.
 *         Only the owner (Wype backend) can deposit, claim, and reverse.
 */
contract Escrow {
    address public owner;

    struct EscrowEntry {
        address sender;
        uint256 amount;
        uint256 expiry;
        bool active;
    }

    // escrowId => EscrowEntry
    mapping(bytes32 => EscrowEntry) private escrows;

    event EscrowDeposited(
        bytes32 indexed escrowId,
        address indexed sender,
        uint256 amount,
        uint256 expiry
    );
    event EscrowClaimed(bytes32 indexed escrowId, uint256 amount);
    event EscrowReversed(
        bytes32 indexed escrowId,
        address indexed sender,
        uint256 amount
    );

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Escrow: caller is not the owner");
        _;
    }

    /**
     * @notice Deposit QUAI into escrow for a given recipient identifier.
     * @param escrowId   Unique identifier (typically the email/phone hash).
     * @param duration   Lock duration in seconds (e.g. 604800 for 7 days).
     * @param sender     Address that initiated the escrow (for reversals).
     */
    function deposit(bytes32 escrowId, uint256 duration, address sender)
        external
        payable
        onlyOwner
    {
        require(msg.value > 0, "Escrow: zero amount");
        require(!escrows[escrowId].active, "Escrow: already active");

        escrows[escrowId] = EscrowEntry({
            sender: sender,
            amount: msg.value,
            expiry: block.timestamp + duration,
            active: true
        });

        emit EscrowDeposited(escrowId, sender, msg.value, block.timestamp + duration);
    }

    /**
     * @notice Claim escrowed funds (releases back to the owner hot wallet).
     *         Called when the recipient has been identified and credited in
     *         the off-chain ledger.
     * @param escrowId  The escrow to claim.
     */
    function claim(bytes32 escrowId) external onlyOwner {
        EscrowEntry storage entry = escrows[escrowId];
        require(entry.active, "Escrow: not active");
        require(block.timestamp <= entry.expiry, "Escrow: expired, use reverse()");

        entry.active = false;
        uint256 amount = entry.amount;

        (bool success, ) = owner.call{value: amount}("");
        require(success, "Escrow: ETH transfer failed");

        emit EscrowClaimed(escrowId, amount);
    }

    /**
     * @notice Reverse an expired escrow, returning funds to the original sender.
     * @param escrowId  The escrow to reverse.
     */
    function reverse(bytes32 escrowId) external onlyOwner {
        EscrowEntry storage entry = escrows[escrowId];
        require(entry.active, "Escrow: not active");
        require(
            block.timestamp > entry.expiry,
            "Escrow: not yet expired"
        );

        entry.active = false;
        uint256 amount = entry.amount;

        (bool success, ) = entry.sender.call{value: amount}("");
        require(success, "Escrow: ETH transfer failed");

        emit EscrowReversed(escrowId, entry.sender, amount);
    }

    /**
     * @notice Read the current state of an escrow entry.
     */
    function getEscrow(bytes32 escrowId)
        external
        view
        returns (
            address sender,
            uint256 amount,
            uint256 expiry,
            bool active
        )
    {
        EscrowEntry storage entry = escrows[escrowId];
        return (entry.sender, entry.amount, entry.expiry, entry.active);
    }

    /**
     * @notice Allow the contract to receive QUAI (e.g. for reversals from
     *         external sources).
     */
    receive() external payable {}
}
