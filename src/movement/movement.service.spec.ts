import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainService } from '../blockchain/blockchain.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { MovementService } from './movement.service';

const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const USER = { _id: USER_ID, walletAddress: `0x${'ab'.repeat(20)}` };
const WALLET = { balance: (10n * 10n ** 18n).toString() };

describe('MovementService', () => {
  let service: MovementService;
  let usersService: { verifyTransactionPin: jest.Mock };
  let walletService: { findByUserId: jest.Mock; debit: jest.Mock };
  let blockchainService: { moveToSelfCustody: jest.Mock };
  let movementModel: { create: jest.Mock };

  beforeEach(async () => {
    usersService = { verifyTransactionPin: jest.fn().mockResolvedValue(USER) };
    walletService = {
      findByUserId: jest.fn().mockResolvedValue(WALLET),
      debit: jest.fn().mockResolvedValue({}),
    };
    blockchainService = {
      moveToSelfCustody: jest
        .fn()
        .mockResolvedValue({ txHash: '0xmock-selfcustody-1' }),
    };
    movementModel = {
      create: jest.fn().mockResolvedValue({
        _id: { toString: () => 'movementId' },
        blipLink: '',
        save: jest.fn().mockResolvedValue({}),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovementService,
        { provide: UsersService, useValue: usersService },
        { provide: WalletService, useValue: walletService },
        { provide: BlockchainService, useValue: blockchainService },
        { provide: getModelToken('Movement'), useValue: movementModel },
      ],
    }).compile();

    service = module.get(MovementService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('moves funds to the self-custody wallet and returns a Blip link', async () => {
    const result = await service.moveToSelfCustody(USER_ID, {
      amount: '2.5',
      pin: '1234',
      currency: 'QUAI',
    });

    expect(usersService.verifyTransactionPin).toHaveBeenCalledWith(
      USER_ID,
      '1234',
    );
    expect(blockchainService.moveToSelfCustody).toHaveBeenCalledWith(
      USER.walletAddress,
      '2500000000000000000',
    );
    expect(walletService.debit).toHaveBeenCalledWith(
      USER_ID,
      '2500000000000000000',
    );
    expect(movementModel.create).toHaveBeenCalledTimes(1);
    expect(result.blipLink).toContain('blippay.me');
    expect(result.blipLink).toContain('/fund/invoice');
    expect(result.blipLink).toContain(encodeURIComponent(USER.walletAddress));
    expect(result.walletAddress).toBe(USER.walletAddress);
  });

  it('rejects a movement that exceeds the balance', async () => {
    walletService.findByUserId.mockResolvedValue({ balance: '1' });

    await expect(
      service.moveToSelfCustody(USER_ID, { amount: '2', pin: '1234' }),
    ).rejects.toThrow(ConflictException);
    expect(blockchainService.moveToSelfCustody).not.toHaveBeenCalled();
    expect(walletService.debit).not.toHaveBeenCalled();
  });

  it('rejects a zero amount', async () => {
    await expect(
      service.moveToSelfCustody(USER_ID, { amount: '0', pin: '1234' }),
    ).rejects.toThrow(BadRequestException);
    expect(blockchainService.moveToSelfCustody).not.toHaveBeenCalled();
  });

  it('requires a self-custody wallet on the account', async () => {
    usersService.verifyTransactionPin.mockResolvedValue({
      _id: USER_ID,
      walletAddress: null,
    });

    await expect(
      service.moveToSelfCustody(USER_ID, { amount: '1', pin: '1234' }),
    ).rejects.toThrow(NotFoundException);
    expect(blockchainService.moveToSelfCustody).not.toHaveBeenCalled();
  });
});
