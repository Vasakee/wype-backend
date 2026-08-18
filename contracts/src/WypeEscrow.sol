// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title WypeEscrow
 * @notice Holds native QUAI for a recipient who does not have a wallet yet.
 *
 * Wype lets you send money to an email address. When the recipient is already a
 * Wype user there is an address to pay and the transfer settles directly. When
 * they are not, there is nowhere to send the funds — so they are locked here
 * until the recipient signs up and claims, or until the deposit expires and the
 * money goes home.
 *
 * Three properties matter:
 *
 * 1. Escrows are keyed by an opaque `commitment`, never by an email or a hash of
 *    one. The hash of any given email address is trivially precomputed, so
 *    keying on the identity would turn this contract into a public list of who
 *    is owed money. The backend derives `commitment = keccak256(identityHash,
 *    salt)` with a fresh random salt per deposit, and keeps the salt in the
 *    claim link.
 *
 * 2. Claiming needs a signature from `verifier`, an off-chain key held by the
 *    Wype backend. Wype already proves control of an email via magic links; the
 *    signature carries that proof on-chain and binds it to one recipient address
 *    and a short deadline, so a leaked claim link is not on its own enough to
 *    move funds.
 *
 * 3. `refund` is permissionless. Once an escrow expires, anybody may return the
 *    money to its depositor — the sender, a watcher, or a stranger. Wype cannot
 *    strand funds by going offline, losing its verifier key, or refusing to act.
 *    The 7-day promise is enforced by this contract, not by Wype's uptime.
 *
 * Value is denominated in QUAI wei. Pegging a deposit to a fiat amount is
 * deliberately left out of this version; it belongs in a later revision that
 * carries a signed price attestation.
 */
contract WypeEscrow is Ownable2Step, ReentrancyGuard {
    /// @notice Longest permitted lifetime of a deposit. Wype uses 7 days.
    uint64 public constant MAX_DURATION = 30 days;

    enum State {
        None,
        Open,
        Claimed,
        Cancelled,
        Refunded
    }

    /// @dev `depositor` (160 bits) and `amount` (96 bits) share one slot;
    ///      `expiry` and `state` share the next. uint96 caps a single deposit at
    ///      ~79.2 billion QUAI, far above any realistic transfer.
    struct Escrow {
        address depositor;
        uint96 amount;
        uint64 expiry;
        State state;
    }

    mapping(bytes32 commitment => Escrow) private _escrows;

    /// @notice Key whose signature authorises a claim. Held by the Wype backend.
    address public verifier;

    event Deposited(
        bytes32 indexed commitment, address indexed depositor, uint256 amount, uint64 expiry
    );
    event Claimed(bytes32 indexed commitment, address indexed to, uint256 amount);
    event Cancelled(bytes32 indexed commitment, address indexed depositor, uint256 amount);
    event Refunded(
        bytes32 indexed commitment, address indexed depositor, uint256 amount, address caller
    );
    event VerifierUpdated(address indexed previousVerifier, address indexed newVerifier);

    error AmountTooLarge();
    error BadSignature();
    error CommitmentInUse();
    error EscrowExpired();
    error ExpiryInPast();
    error ExpiryTooFar();
    error InvalidCommitment();
    error InvalidRecipient();
    error InvalidVerifier();
    error NotClaimable();
    error NotCancellable();
    error NotDepositor();
    error NotRefundable();
    error NotYetExpired();
    error SignatureExpired();
    error TransferFailed();
    error ZeroAmount();

    constructor(address initialOwner, address initialVerifier) Ownable(initialOwner) {
        if (initialVerifier == address(0)) revert InvalidVerifier();
        verifier = initialVerifier;
        emit VerifierUpdated(address(0), initialVerifier);
    }

    /**
     * @notice Locks the sent QUAI against `commitment` until `expiry`.
     * @param commitment Opaque handle for this deposit: keccak256(identityHash, salt).
     * @param expiry Unix timestamp after which the deposit may be refunded.
     */
    function deposit(bytes32 commitment, uint64 expiry) external payable {
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (msg.value == 0) revert ZeroAmount();
        if (msg.value > type(uint96).max) revert AmountTooLarge();
        if (_escrows[commitment].state != State.None) revert CommitmentInUse();
        if (expiry <= block.timestamp) revert ExpiryInPast();
        if (expiry > block.timestamp + MAX_DURATION) revert ExpiryTooFar();

        _escrows[commitment] =
            Escrow({depositor: msg.sender, amount: uint96(msg.value), expiry: expiry, state: State.Open});

        emit Deposited(commitment, msg.sender, msg.value, expiry);
    }

    /**
     * @notice Releases a deposit to `to`, given the verifier's blessing.
     * @dev The signature covers `to`, so it cannot be replayed to a different
     *      address, and `deadline`, so a captured signature goes stale.
     * @param commitment The deposit's handle.
     * @param to Address receiving the funds — the claimant's Wype wallet.
     * @param deadline Unix timestamp after which the signature is void.
     * @param signature `verifier`'s EIP-191 signature over {claimDigest}.
     */
    function claim(bytes32 commitment, address payable to, uint64 deadline, bytes calldata signature)
        external
        nonReentrant
    {
        Escrow storage escrow = _escrows[commitment];

        if (escrow.state != State.Open) revert NotClaimable();
        if (block.timestamp > escrow.expiry) revert EscrowExpired();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (to == address(0)) revert InvalidRecipient();

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(claimDigest(commitment, to, deadline));
        if (ECDSA.recover(digest, signature) != verifier) revert BadSignature();

        uint256 amount = escrow.amount;
        escrow.state = State.Claimed;

        emit Claimed(commitment, to, amount);
        _pay(to, amount);
    }

    /**
     * @notice Returns an unclaimed deposit to its depositor ahead of expiry.
     * @dev Only the depositor may pull funds back early; after expiry anybody
     *      can, through {refund}.
     */
    function cancel(bytes32 commitment) external nonReentrant {
        Escrow storage escrow = _escrows[commitment];

        if (escrow.state != State.Open) revert NotCancellable();
        if (msg.sender != escrow.depositor) revert NotDepositor();
        if (block.timestamp > escrow.expiry) revert EscrowExpired();

        address depositor = escrow.depositor;
        uint256 amount = escrow.amount;
        escrow.state = State.Cancelled;

        emit Cancelled(commitment, depositor, amount);
        _pay(payable(depositor), amount);
    }

    /**
     * @notice Returns an expired deposit to its depositor. Callable by anyone.
     * @dev This is the guarantee that Wype cannot hold funds hostage. The caller
     *      gains nothing but the funds always go home, so anyone — including the
     *      original sender — can settle a forgotten escrow without Wype's help.
     */
    function refund(bytes32 commitment) external nonReentrant {
        Escrow storage escrow = _escrows[commitment];

        if (escrow.state != State.Open) revert NotRefundable();
        if (block.timestamp <= escrow.expiry) revert NotYetExpired();

        address depositor = escrow.depositor;
        uint256 amount = escrow.amount;
        escrow.state = State.Refunded;

        emit Refunded(commitment, depositor, amount, msg.sender);
        _pay(payable(depositor), amount);
    }

    /// @notice Rotates the claim-authorising key, e.g. after a backend key compromise.
    function setVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert InvalidVerifier();
        emit VerifierUpdated(verifier, newVerifier);
        verifier = newVerifier;
    }

    /**
     * @notice The message the verifier signs to authorise a claim.
     * @dev `block.chainid` and `address(this)` scope the signature to this
     *      contract on this chain, so a signature produced on testnet is
     *      worthless on mainnet and vice versa.
     */
    function claimDigest(bytes32 commitment, address to, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), commitment, to, deadline));
    }

    /// @notice Reads a deposit's full record.
    function getEscrow(bytes32 commitment) external view returns (Escrow memory) {
        return _escrows[commitment];
    }

    /// @notice True when the deposit is still open and not yet past its expiry.
    function isClaimable(bytes32 commitment) external view returns (bool) {
        Escrow storage escrow = _escrows[commitment];
        return escrow.state == State.Open && block.timestamp <= escrow.expiry;
    }

    function _pay(address payable to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
