// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title WypeRegistry
/// @notice On-chain name registry for Wype usernames.
contract WypeRegistry is Ownable2Step {
    mapping(string => address) private _forward;
    mapping(address => string) private _reverse;
    mapping(string => bool) private _registered;

    uint256 public nameCount;

    event NameRegistered(string name, address indexed walletAddress, uint256 index);
    event NameTransferred(string name, address indexed from, address indexed to);
    event NameCleared(string name, address indexed previousOwner);

    error AlreadyRegistered();
    error NameNotRegistered();
    error ZeroAddress();
    error NameTooShort();
    error NameTooLong();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function register(string calldata name, address walletAddress) external onlyOwner {
        if (walletAddress == address(0)) revert ZeroAddress();
        if (bytes(name).length < 3) revert NameTooShort();
        if (bytes(name).length > 31) revert NameTooLong();
        if (_registered[name]) revert AlreadyRegistered();

        _registered[name] = true;
        _forward[name] = walletAddress;
        _reverse[walletAddress] = name;
        nameCount++;

        emit NameRegistered(name, walletAddress, nameCount);
    }

    function transfer(string calldata name, address newAddress) external onlyOwner {
        if (!_registered[name]) revert NameNotRegistered();
        if (newAddress == address(0)) revert ZeroAddress();

        address previousOwner = _forward[name];
        _forward[name] = newAddress;
        _reverse[newAddress] = name;

        emit NameTransferred(name, previousOwner, newAddress);
    }

    function clear(string calldata name) external onlyOwner {
        if (!_registered[name]) revert NameNotRegistered();

        address previousOwner = _forward[name];
        _registered[name] = false;
        delete _forward[name];
        nameCount--;

        emit NameCleared(name, previousOwner);
    }

    function resolve(string calldata name) external view returns (address) {
        return _forward[name];
    }

    function isAvailable(string calldata name) external view returns (bool) {
        return !_registered[name];
    }

    function nameOf(address walletAddress) external view returns (string memory) {
        return _reverse[walletAddress];
    }
}
