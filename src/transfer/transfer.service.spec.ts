import { UnauthorizedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { BlockchainService } from '../blockchain/blockchain.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import {
  Transfer,
  TransferStatus,
  TransferType,
} from './schemas/transfer.schema';
import { TransferService } from './transfer.service';

const SENDER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const RECIPIENT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

describe('TransferService', () => {
  let service: TransferService;
  let transferModel: { create: jest.Mock };
  let usersService: {
    findByIdWithPin: jest.Mock;
    findByEmail: jest.Mock;
    findByPhoneNumber: jest.Mock;
  };
  let walletService: {
    findByUserId: jest.Mock;
    debit: jest.Mock;
    credit: jest.Mock;
  };
  let blockchainService: {
    hashEmail: jest.Mock;
    resolveEmail: jest.Mock;
    directTransfer: jest.Mock;
    depositToEscrow: jest.Mock;
    claimEscrow: jest.Mock;
  };
  let whatsappService: { sendMessage: jest.Mock };

  const pinHash = bcrypt.hashSync('1234', 4);
  const sender = {
    _id: SENDER_ID,
    isEmailVerified: true,
    transactionPin: pinHash,
    phoneNumber: '+15550000001',
  };
  const recipient = {
    _id: RECIPIENT_ID,
    phoneNumber: '+15550000002',
  };

  beforeEach(async () => {
    transferModel = { create: jest.fn((doc) => Promise.resolve(doc)) };
    usersService = {
      findByIdWithPin: jest.fn().mockResolvedValue(sender),
      findByEmail: jest.fn(),
      findByPhoneNumber: jest.fn(),
    };
    walletService = {
      findByUserId: jest
        .fn()
        .mockResolvedValue({ address: '0xabc', balance: '0' }),
      debit: jest.fn().mockResolvedValue(undefined),
      credit: jest.fn().mockResolvedValue(undefined),
    };
    blockchainService = {
      hashEmail: jest.fn((email) => `hash-${email}`),
      resolveEmail: jest.fn(),
      directTransfer: jest.fn().mockResolvedValue({ txHash: '0xdirect' }),
      depositToEscrow: jest
        .fn()
        .mockResolvedValue({ txHash: '0xescrow', escrowId: 'hash-bob' }),
      claimEscrow: jest.fn().mockResolvedValue({ txHash: '0xclaim' }),
    };
    whatsappService = { sendMessage: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransferService,
        { provide: getModelToken(Transfer.name), useValue: transferModel },
        { provide: UsersService, useValue: usersService },
        { provide: WalletService, useValue: walletService },
        { provide: BlockchainService, useValue: blockchainService },
        { provide: WhatsappService, useValue: whatsappService },
      ],
    }).compile();

    service = module.get(TransferService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('PIN verification', () => {
    it('rejects the transfer when the PIN does not match', async () => {
      await expect(
        service.sendByEmail(SENDER_ID, {
          recipientEmail: 'bob@example.com',
          amount: '5',
          pin: '9999',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(transferModel.create).not.toHaveBeenCalled();
      expect(walletService.debit).not.toHaveBeenCalled();
    });

    it('rejects the transfer when no PIN is set', async () => {
      usersService.findByIdWithPin.mockResolvedValue({
        ...sender,
        transactionPin: undefined,
      });

      await expect(
        service.sendByEmail(SENDER_ID, {
          recipientEmail: 'bob@example.com',
          amount: '5',
          pin: '1234',
        }),
      ).rejects.toThrow('Set a transaction PIN before sending money');
    });
  });

  describe('routing', () => {
    it('escrows when the recipient email is not registered in the registry', async () => {
      usersService.findByEmail.mockResolvedValue(recipient);
      blockchainService.resolveEmail.mockResolvedValue(null);

      const transfer = await service.sendByEmail(SENDER_ID, {
        recipientEmail: 'bob@example.com',
        amount: '5',
        pin: '1234',
      });

      expect(blockchainService.depositToEscrow).toHaveBeenCalled();
      expect(transfer.type).toBe(TransferType.Escrow);
      expect(transfer.status).toBe(TransferStatus.Escrowed);
      expect(walletService.debit).toHaveBeenCalledWith(
        SENDER_ID,
        expect.any(String),
      );
      expect(walletService.credit).not.toHaveBeenCalled();
    });

    it('performs a direct transfer when the recipient is registered', async () => {
      usersService.findByEmail.mockResolvedValue(recipient);
      blockchainService.resolveEmail.mockResolvedValue('0xrecipient');

      const transfer = await service.sendByEmail(SENDER_ID, {
        recipientEmail: 'bob@example.com',
        amount: '5',
        pin: '1234',
      });

      expect(blockchainService.directTransfer).toHaveBeenCalledWith(
        '0xrecipient',
        expect.any(String),
      );
      expect(transfer.type).toBe(TransferType.Direct);
      expect(transfer.status).toBe(TransferStatus.Completed);
      expect(walletService.credit).toHaveBeenCalledWith(
        RECIPIENT_ID,
        expect.any(String),
      );
    });
  });
});
