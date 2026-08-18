// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {WypeEscrow} from "../src/WypeEscrow.sol";

contract WypeEscrowTest is Test {
    WypeEscrow internal escrow;

    uint256 internal constant VERIFIER_PK = 0xA11CE;
    uint256 internal constant ATTACKER_PK = 0xBAD;

    address internal owner = makeAddr("owner");
    address internal verifier = vm.addr(VERIFIER_PK);
    address internal sender = makeAddr("sender");
    address payable internal chidi = payable(makeAddr("chidi"));
    address internal stranger = makeAddr("stranger");

    /// Stands in for keccak256(identityHash, salt) — opaque on purpose.
    bytes32 internal constant COMMITMENT = keccak256("commitment-1");

    uint64 internal constant SEVEN_DAYS = 7 days;
    uint256 internal constant AMOUNT = 5 ether;

    function setUp() public {
        escrow = new WypeEscrow(owner, verifier);
        vm.deal(sender, 100 ether);
        // Timestamps start at 1 in Foundry; move forward so expiries are sane.
        vm.warp(1_700_000_000);
    }

    /*//////////////////////////////////////////////////////////////
                                 HELPERS
    //////////////////////////////////////////////////////////////*/

    function _expiry() internal view returns (uint64) {
        return uint64(block.timestamp + SEVEN_DAYS);
    }

    function _deposit(bytes32 commitment, uint256 amount) internal returns (uint64 expiry) {
        expiry = _expiry();
        vm.prank(sender);
        escrow.deposit{value: amount}(commitment, expiry);
    }

    function _sign(uint256 pk, bytes32 commitment, address to, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(escrow.claimDigest(commitment, to, deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /*//////////////////////////////////////////////////////////////
                                 DEPOSIT
    //////////////////////////////////////////////////////////////*/

    function test_Deposit_LocksFundsInContract() public {
        uint64 expiry = _deposit(COMMITMENT, AMOUNT);

        assertEq(address(escrow).balance, AMOUNT, "contract holds the funds");
        assertEq(sender.balance, 95 ether, "sender was debited");

        WypeEscrow.Escrow memory record = escrow.getEscrow(COMMITMENT);
        assertEq(record.depositor, sender);
        assertEq(record.amount, AMOUNT);
        assertEq(record.expiry, expiry);
        assertTrue(record.state == WypeEscrow.State.Open);
        assertTrue(escrow.isClaimable(COMMITMENT));
    }

    function test_Deposit_EmitsEvent() public {
        uint64 expiry = _expiry();
        vm.expectEmit(true, true, false, true);
        emit WypeEscrow.Deposited(COMMITMENT, sender, AMOUNT, expiry);
        vm.prank(sender);
        escrow.deposit{value: AMOUNT}(COMMITMENT, expiry);
    }

    function test_RevertWhen_DepositReusesCommitment() public {
        _deposit(COMMITMENT, AMOUNT);
        vm.prank(sender);
        vm.expectRevert(WypeEscrow.CommitmentInUse.selector);
        escrow.deposit{value: AMOUNT}(COMMITMENT, _expiry());
    }

    function test_RevertWhen_DepositIsZero() public {
        vm.prank(sender);
        vm.expectRevert(WypeEscrow.ZeroAmount.selector);
        escrow.deposit{value: 0}(COMMITMENT, _expiry());
    }

    function test_RevertWhen_CommitmentIsEmpty() public {
        vm.prank(sender);
        vm.expectRevert(WypeEscrow.InvalidCommitment.selector);
        escrow.deposit{value: AMOUNT}(bytes32(0), _expiry());
    }

    function test_RevertWhen_ExpiryInPast() public {
        vm.prank(sender);
        vm.expectRevert(WypeEscrow.ExpiryInPast.selector);
        escrow.deposit{value: AMOUNT}(COMMITMENT, uint64(block.timestamp - 1));
    }

    function test_RevertWhen_ExpiryBeyondMaxDuration() public {
        vm.prank(sender);
        vm.expectRevert(WypeEscrow.ExpiryTooFar.selector);
        escrow.deposit{value: AMOUNT}(COMMITMENT, uint64(block.timestamp + 31 days));
    }

    /*//////////////////////////////////////////////////////////////
                                  CLAIM
    //////////////////////////////////////////////////////////////*/

    function test_Claim_PaysRecipient() public {
        _deposit(COMMITMENT, AMOUNT);

        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(VERIFIER_PK, COMMITMENT, chidi, deadline);

        escrow.claim(COMMITMENT, chidi, deadline, sig);

        assertEq(chidi.balance, AMOUNT, "recipient was paid");
        assertEq(address(escrow).balance, 0, "contract drained");
        assertTrue(escrow.getEscrow(COMMITMENT).state == WypeEscrow.State.Claimed);
        assertFalse(escrow.isClaimable(COMMITMENT));
    }

    /// Anyone may relay a valid signature — Wype pays gas today, the claimant could tomorrow.
    function test_Claim_CanBeRelayedByAnyone() public {
        _deposit(COMMITMENT, AMOUNT);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(VERIFIER_PK, COMMITMENT, chidi, deadline);

        vm.prank(stranger);
        escrow.claim(COMMITMENT, chidi, deadline, sig);

        assertEq(chidi.balance, AMOUNT);
    }

    function test_RevertWhen_SignatureIsFromWrongKey() public {
        _deposit(COMMITMENT, AMOUNT);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(ATTACKER_PK, COMMITMENT, chidi, deadline);

        vm.expectRevert(WypeEscrow.BadSignature.selector);
        escrow.claim(COMMITMENT, chidi, deadline, sig);
    }

    /// The signature names the recipient, so it cannot be pointed somewhere else.
    function test_RevertWhen_SignatureRedirectedToAnotherAddress() public {
        _deposit(COMMITMENT, AMOUNT);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(VERIFIER_PK, COMMITMENT, chidi, deadline);

        vm.prank(stranger);
        vm.expectRevert(WypeEscrow.BadSignature.selector);
        escrow.claim(COMMITMENT, payable(stranger), deadline, sig);
    }

    /// A signature for one deposit must not unlock another.
    function test_RevertWhen_SignatureReusedOnDifferentCommitment() public {
        bytes32 other = keccak256("commitment-2");
        _deposit(COMMITMENT, AMOUNT);
        _deposit(other, AMOUNT);

        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(VERIFIER_PK, COMMITMENT, chidi, deadline);

        vm.expectRevert(WypeEscrow.BadSignature.selector);
        escrow.claim(other, chidi, deadline, sig);
    }

    function test_RevertWhen_SignatureDeadlinePassed() public {
        _deposit(COMMITMENT, AMOUNT);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(VERIFIER_PK, COMMITMENT, chidi, deadline);

        vm.warp(deadline + 1);
        vm.expectRevert(WypeEscrow.SignatureExpired.selector);
        escrow.claim(COMMITMENT, chidi, deadline, sig);
    }

    function test_RevertWhen_ClaimAfterEscrowExpiry() public {
        uint64 expiry = _deposit(COMMITMENT, AMOUNT);
        vm.warp(expiry + 1);

        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(VERIFIER_PK, COMMITMENT, chidi, deadline);

        vm.expectRevert(WypeEscrow.EscrowExpired.selector);
        escrow.claim(COMMITMENT, chidi, deadline, sig);
    }

    function test_RevertWhen_ClaimedTwice() public {
        _deposit(COMMITMENT, AMOUNT);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(VERIFIER_PK, COMMITMENT, chidi, deadline);

        escrow.claim(COMMITMENT, chidi, deadline, sig);

        vm.expectRevert(WypeEscrow.NotClaimable.selector);
        escrow.claim(COMMITMENT, chidi, deadline, sig);
    }

    /// A signature minted for another chain id must not work here.
    function test_RevertWhen_SignatureFromAnotherChain() public {
        _deposit(COMMITMENT, AMOUNT);
        uint64 deadline = uint64(block.timestamp + 1 hours);

        uint256 originalChainId = block.chainid;
        vm.chainId(originalChainId + 1);
        bytes memory foreignSig = _sign(VERIFIER_PK, COMMITMENT, chidi, deadline);
        vm.chainId(originalChainId);

        vm.expectRevert(WypeEscrow.BadSignature.selector);
        escrow.claim(COMMITMENT, chidi, deadline, foreignSig);
    }

    /*//////////////////////////////////////////////////////////////
                                 CANCEL
    //////////////////////////////////////////////////////////////*/

    function test_Cancel_ReturnsFundsToSender() public {
        _deposit(COMMITMENT, AMOUNT);

        vm.prank(sender);
        escrow.cancel(COMMITMENT);

        assertEq(sender.balance, 100 ether, "sender made whole");
        assertTrue(escrow.getEscrow(COMMITMENT).state == WypeEscrow.State.Cancelled);
    }

    function test_RevertWhen_CancelledByNonDepositor() public {
        _deposit(COMMITMENT, AMOUNT);

        vm.prank(stranger);
        vm.expectRevert(WypeEscrow.NotDepositor.selector);
        escrow.cancel(COMMITMENT);
    }

    function test_RevertWhen_CancelAfterExpiry() public {
        uint64 expiry = _deposit(COMMITMENT, AMOUNT);
        vm.warp(expiry + 1);

        vm.prank(sender);
        vm.expectRevert(WypeEscrow.EscrowExpired.selector);
        escrow.cancel(COMMITMENT);
    }

    function test_RevertWhen_CancelAfterClaim() public {
        _deposit(COMMITMENT, AMOUNT);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        escrow.claim(COMMITMENT, chidi, deadline, _sign(VERIFIER_PK, COMMITMENT, chidi, deadline));

        vm.prank(sender);
        vm.expectRevert(WypeEscrow.NotCancellable.selector);
        escrow.cancel(COMMITMENT);
    }

    /*//////////////////////////////////////////////////////////////
                                 REFUND
    //////////////////////////////////////////////////////////////*/

    /// The headline guarantee: Wype is not needed to get the money back.
    function test_Refund_IsPermissionlessAfterExpiry() public {
        uint64 expiry = _deposit(COMMITMENT, AMOUNT);
        vm.warp(expiry + 1);

        vm.prank(stranger);
        escrow.refund(COMMITMENT);

        assertEq(sender.balance, 100 ether, "funds went home to the depositor");
        assertEq(stranger.balance, 0, "caller gains nothing");
        assertTrue(escrow.getEscrow(COMMITMENT).state == WypeEscrow.State.Refunded);
    }

    function test_RevertWhen_RefundBeforeExpiry() public {
        _deposit(COMMITMENT, AMOUNT);

        vm.expectRevert(WypeEscrow.NotYetExpired.selector);
        escrow.refund(COMMITMENT);
    }

    function test_RevertWhen_RefundedTwice() public {
        uint64 expiry = _deposit(COMMITMENT, AMOUNT);
        vm.warp(expiry + 1);

        escrow.refund(COMMITMENT);
        vm.expectRevert(WypeEscrow.NotRefundable.selector);
        escrow.refund(COMMITMENT);
    }

    function test_RevertWhen_RefundUnknownCommitment() public {
        vm.expectRevert(WypeEscrow.NotRefundable.selector);
        escrow.refund(keccak256("never-deposited"));
    }

    /*//////////////////////////////////////////////////////////////
                                VERIFIER
    //////////////////////////////////////////////////////////////*/

    function test_SetVerifier_InvalidatesOldKey() public {
        _deposit(COMMITMENT, AMOUNT);
        address newVerifier = vm.addr(ATTACKER_PK);

        vm.prank(owner);
        escrow.setVerifier(newVerifier);
        assertEq(escrow.verifier(), newVerifier);

        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory oldSig = _sign(VERIFIER_PK, COMMITMENT, chidi, deadline);
        vm.expectRevert(WypeEscrow.BadSignature.selector);
        escrow.claim(COMMITMENT, chidi, deadline, oldSig);

        // The rotated key works.
        escrow.claim(COMMITMENT, chidi, deadline, _sign(ATTACKER_PK, COMMITMENT, chidi, deadline));
        assertEq(chidi.balance, AMOUNT);
    }

    function test_RevertWhen_SetVerifierByNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setVerifier(stranger);
    }

    function test_RevertWhen_VerifierSetToZero() public {
        vm.prank(owner);
        vm.expectRevert(WypeEscrow.InvalidVerifier.selector);
        escrow.setVerifier(address(0));
    }

    /*//////////////////////////////////////////////////////////////
                              FULL LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    /// Two concurrent escrows must not interfere with one another.
    function test_ConcurrentEscrowsSettleIndependently() public {
        bytes32 first = keccak256("first");
        bytes32 second = keccak256("second");

        uint64 expiry = _deposit(first, 2 ether);
        _deposit(second, 3 ether);
        assertEq(address(escrow).balance, 5 ether);

        uint64 deadline = uint64(block.timestamp + 1 hours);
        escrow.claim(first, chidi, deadline, _sign(VERIFIER_PK, first, chidi, deadline));
        assertEq(chidi.balance, 2 ether);
        assertEq(address(escrow).balance, 3 ether);

        vm.warp(expiry + 1);
        escrow.refund(second);
        assertEq(address(escrow).balance, 0);
        assertEq(sender.balance, 98 ether, "only the claimed 2 ether left the sender");
    }

    function testFuzz_DepositThenClaimPaysExactAmount(uint96 amount, uint64 lifetime) public {
        amount = uint96(bound(amount, 1, 1_000 ether));
        lifetime = uint64(bound(lifetime, 1, escrow.MAX_DURATION()));

        vm.deal(sender, amount);
        uint64 expiry = uint64(block.timestamp) + lifetime;

        vm.prank(sender);
        escrow.deposit{value: amount}(COMMITMENT, expiry);

        uint64 deadline = uint64(block.timestamp + 1);
        escrow.claim(COMMITMENT, chidi, deadline, _sign(VERIFIER_PK, COMMITMENT, chidi, deadline));

        assertEq(chidi.balance, amount);
        assertEq(address(escrow).balance, 0);
    }

    function testFuzz_RefundAlwaysReturnsPrincipal(uint96 amount, uint64 lifetime) public {
        amount = uint96(bound(amount, 1, 1_000 ether));
        lifetime = uint64(bound(lifetime, 1, escrow.MAX_DURATION()));

        vm.deal(sender, amount);
        uint64 expiry = uint64(block.timestamp) + lifetime;

        vm.prank(sender);
        escrow.deposit{value: amount}(COMMITMENT, expiry);
        assertEq(sender.balance, 0);

        vm.warp(uint256(expiry) + 1);
        vm.prank(stranger);
        escrow.refund(COMMITMENT);

        assertEq(sender.balance, amount, "principal returned in full");
    }
}
