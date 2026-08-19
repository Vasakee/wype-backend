// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WypeRegistry} from "../src/WypeRegistry.sol";

contract WypeRegistryTest is Test {
    WypeRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    function setUp() public {
        registry = new WypeRegistry(owner);
    }

    /*//////////////////////////////////////////////////////////////
                                 REGISTRATION
    //////////////////////////////////////////////////////////////*/

    function test_register_maps_name_to_address() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);

        assertEq(registry.resolve("basil.quai"), alice);
    }

    function test_register_sets_reverse_mapping() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);

        assertEq(registry.nameOf(alice), "basil.quai");
    }

    function test_register_increments_name_count() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);
        assertEq(registry.nameCount(), 1);

        vm.prank(owner);
        registry.register("alice.quai", bob);
        assertEq(registry.nameCount(), 2);
    }

    function test_register_emits_event() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit WypeRegistry.NameRegistered("basil.quai", alice, 1);
        registry.register("basil.quai", alice);
    }

    function test_register_marks_as_registered() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);

        assertTrue(registry.isAvailable("basil.quai") == false);
    }

    /*//////////////////////////////////////////////////////////////
                              AVAILABILITY
    //////////////////////////////////////////////////////////////*/

    function test_isAvailable_returns_true_for_unregistered() public {
        assertTrue(registry.isAvailable("basil.quai"));
    }

    function test_isAvailable_returns_false_for_registered() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);

        assertFalse(registry.isAvailable("basil.quai"));
    }

    /*//////////////////////////////////////////////////////////////
                            TRANSFER NAME
    //////////////////////////////////////////////////////////////*/

    function test_transfer_moves_name_to_new_address() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);

        vm.prank(owner);
        registry.transfer("basil.quai", bob);

        assertEq(registry.resolve("basil.quai"), bob);
        assertEq(registry.nameOf(bob), "basil.quai");
    }

    function test_transfer_emits_event() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);

        vm.prank(owner);
        vm.expectEmit(false, true, false, true);
        emit WypeRegistry.NameTransferred("basil.quai", alice, bob);
        registry.transfer("basil.quai", bob);
    }

    /*//////////////////////////////////////////////////////////////
                             CLEAR NAME
    //////////////////////////////////////////////////////////////*/

    function test_clear_removes_registration() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);

        vm.prank(owner);
        registry.clear("basil.quai");

        assertEq(registry.resolve("basil.quai"), address(0));
        assertTrue(registry.isAvailable("basil.quai"));
    }

    function test_clear_decrements_name_count() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);
        vm.prank(owner);
        registry.register("alice.quai", bob);

        vm.prank(owner);
        registry.clear("basil.quai");

        assertEq(registry.nameCount(), 1);
    }

    function test_clear_emits_event() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);

        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit WypeRegistry.NameCleared("basil.quai", alice);
        registry.clear("basil.quai");
    }

    /*//////////////////////////////////////////////////////////////
                          ACCESS CONTROL
    //////////////////////////////////////////////////////////////*/

    function test_register_reverts_for_non_owner() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.register("basil.quai", alice);
    }

    function test_transfer_reverts_for_non_owner() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);

        vm.prank(alice);
        vm.expectRevert();
        registry.transfer("basil.quai", bob);
    }

    function test_clear_reverts_for_non_owner() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);

        vm.prank(alice);
        vm.expectRevert();
        registry.clear("basil.quai");
    }

    /*//////////////////////////////////////////////////////////////
                            ERROR CASES
    //////////////////////////////////////////////////////////////*/

    function test_register_reverts_zero_address() public {
        vm.prank(owner);
        vm.expectRevert(WypeRegistry.ZeroAddress.selector);
        registry.register("basil.quai", address(0));
    }

    function test_register_reverts_too_short() public {
        vm.prank(owner);
        vm.expectRevert(WypeRegistry.NameTooShort.selector);
        registry.register("ab", alice);
    }

    function test_register_reverts_too_long() public {
        vm.prank(owner);
        vm.expectRevert(WypeRegistry.NameTooLong.selector);
        registry.register("a]2345678901234567890123456789012", alice);
    }

    function test_register_reverts_already_registered() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);

        vm.prank(owner);
        vm.expectRevert(WypeRegistry.AlreadyRegistered.selector);
        registry.register("basil.quai", bob);
    }

    function test_transfer_reverts_not_registered() public {
        vm.prank(owner);
        vm.expectRevert(WypeRegistry.NameNotRegistered.selector);
        registry.transfer("basil.quai", bob);
    }

    function test_transfer_reverts_zero_address() public {
        vm.prank(owner);
        registry.register("basil.quai", alice);

        vm.prank(owner);
        vm.expectRevert(WypeRegistry.ZeroAddress.selector);
        registry.transfer("basil.quai", address(0));
    }

    function test_clear_reverts_not_registered() public {
        vm.prank(owner);
        vm.expectRevert(WypeRegistry.NameNotRegistered.selector);
        registry.clear("basil.quai");
    }

    /*//////////////////////////////////////////////////////////////
                            RESOLVE EDGE
    //////////////////////////////////////////////////////////////*/

    function test_resolve_returns_zero_for_unregistered() public {
        assertEq(registry.resolve("nobody.quai"), address(0));
    }

    function test_nameOf_returns_empty_for_unknown() public {
        assertEq(registry.nameOf(alice), "");
    }
}
