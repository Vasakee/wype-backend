import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth/auth.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { EmailService } from '../email/email.service';
import { EscrowService } from '../escrow/escrow.service';
import { FeesService } from '../fees/fees.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
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
    verifyTransactionPin: jest.Mock;
    findByEmail: jest.Mock;
    findByPhoneNumber: jest.Mock;
    findByUsername: jest.Mock;
  };
  let walletService: {
    findByUserId: jest.Mock;
    debit: jest.Mock;
    credit: jest.Mock;
  };
  let blockchainService: {
    hashEmail: jest.Mock;
    directTransfer: jest.Mock;
    depositToEscrow: jest.Mock;
    reverseEscrow: jest.Mock;
  };
  let escrowService: { reverseExpiredEscrows: jest.Mock; claim: jest.Mock };
  let emailService: { send: jest.Mock };
  let whatsappService: { sendMessage: jest.Mock };
  let feesService: { calculate: jest.Mock };
  let authService: { issueClaimLink: jest.Mock };
  let configService: { get: jest.Mock };

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
      verifyTransactionPin: jest.fn().mockResolvedValue(sender),
      findByEmail: jest.fn(),
      findByPhoneNumber: jest.fn(),
      findByUsername: jest.fn(),
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
      directTransfer: jest.fn().mockResolvedValue({ txHash: '0xdirect' }),
      depositToEscrow: jest
        .fn()
        .mockResolvedValue({ txHash: '0xescrow', escrowId: 'hash-bob' }),
      reverseEscrow: jest.fn().mockResolvedValue({ txHash: '0xreverse' }),
    };
    escrowService = {
      reverseExpiredEscrows: jest.fn().mockResolvedValue(0),
      claim: jest.fn(),
    };
    emailService = { send: jest.fn() };
    whatsappService = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    feesService = { calculate: jest.fn().mockReturnValue('0.025') };
    authService = { issueClaimLink: jest.fn().mockResolvedValue({ ok: true }) };
    configService = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransferService,
        { provide: getModelToken(Transfer.name), useValue: transferModel },
        { provide: UsersService, useValue: usersService },
        { provide: WalletService, useValue: walletService },
        { provide: BlockchainService, useValue: blockchainService },
        { provide: EscrowService, useValue: escrowService },
        { provide: EmailService, useValue: emailService },
        { provide: 'WHATSAPP_SERVICE', useValue: whatsappService },
        { provide: FeesService, useValue: feesService },
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(TransferService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('PIN verification', () => {
    it('rejects the transfer when the PIN does not match', async () => {
      usersService.verifyTransactionPin.mockRejectedValue(
        new UnauthorizedException('Invalid transaction PIN'),
      );

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
      usersService.verifyTransactionPin.mockRejectedValue(
        new Error('Set a transaction PIN before sending money'),
      );

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
    it('escrows when the recipient email is not registered', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      const transfer = await service.sendByEmail(SENDER_ID, {
        recipientEmail: 'bob@example.com',
        amount: '5',
        pin: '1234',
      });

      expect(blockchainService.depositToEscrow).toHaveBeenCalledWith(
        'hash-bob@example.com',
        expect.any(String),
      );
      expect(transfer.type).toBe(TransferType.Send);
      expect(transfer.status).toBe(TransferStatus.Escrowed);
      expect(transfer.escrowExpiry).toBeInstanceOf(Date);
      expect(walletService.debit).toHaveBeenCalledWith(
        SENDER_ID,
        expect.any(String),
      );
      expect(walletService.credit).not.toHaveBeenCalled();
      expect(emailService.send).toHaveBeenCalledWith(
        'bob@example.com',
        expect.any(String),
        expect.any(String),
      );
    });

    it('performs a direct transfer when the recipient is registered', async () => {
      usersService.findByEmail.mockResolvedValue(recipient);

      const transfer = await service.sendByEmail(SENDER_ID, {
        recipientEmail: 'bob@example.com',
        amount: '5',
        pin: '1234',
      });

      expect(blockchainService.directTransfer).toHaveBeenCalledWith(
        '0xabc',
        expect.any(String),
      );
      expect(transfer.type).toBe(TransferType.Send);
      expect(transfer.status).toBe(TransferStatus.Completed);
      expect(walletService.credit).toHaveBeenCalledWith(
        RECIPIENT_ID,
        expect.any(String),
      );
      expect(emailService.send).not.toHaveBeenCalled();
      expect(whatsappService.sendMessage).toHaveBeenCalled();
    });

    it('resolves a username recipient and performs a direct transfer', async () => {
      usersService.findByUsername.mockResolvedValue(recipient);

      const transfer = await service.sendByWhatsapp(SENDER_ID, {
        recipientUsername: 'basil.quai',
        amount: '5',
        pin: '1234',
      });

      expect(usersService.findByUsername).toHaveBeenCalledWith('basil.quai');
      expect(transfer.type).toBe(TransferType.Send);
      expect(transfer.status).toBe(TransferStatus.Completed);
      expect(walletService.credit).toHaveBeenCalledWith(
        RECIPIENT_ID,
        expect.any(String),
      );
    });

    it('rejects an unregistered username recipient', async () => {
      usersService.findByUsername.mockResolvedValue(null);

      await expect(
        service.sendByWhatsapp(SENDER_ID, {
          recipientUsername: 'ghost',
          amount: '5',
          pin: '1234',
        }),
      ).rejects.toThrow('Recipient username must be registered on Wype');
      expect(walletService.debit).not.toHaveBeenCalled();
    });
  });
});
