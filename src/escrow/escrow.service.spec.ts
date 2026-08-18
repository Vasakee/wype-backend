import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainService } from '../blockchain/blockchain.service';
import {
  Transfer,
  TransferStatus,
  TransferType,
} from '../transfer/schemas/transfer.schema';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { EscrowService } from './escrow.service';

const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SENDER_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ESCROW_ID = 'cccccccccccccccccccccccc';

describe('EscrowService', () => {
  let service: EscrowService;
  let transferModel: { find: jest.Mock; create: jest.Mock };
  let usersService: { verifyTransactionPin: jest.Mock };
  let walletService: { credit: jest.Mock };
  let blockchainService: {
    hashEmail: jest.Mock;
    claimEscrow: jest.Mock;
    reverseEscrow: jest.Mock;
  };

  const buildEscrowDoc = (overrides: Record<string, unknown> = {}) => ({
    _id: ESCROW_ID,
    sender: SENDER_ID,
    recipientEmail: 'bob@example.com',
    amount: '5000000000000000000',
    currency: 'QUAI',
    channel: 'web',
    escrowExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
    escrowId: 'escrow-1',
    status: TransferStatus.Escrowed,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  beforeEach(async () => {
    transferModel = {
      find: jest.fn(),
      create: jest.fn((doc) => Promise.resolve(doc)),
    };
    usersService = {
      verifyTransactionPin: jest
        .fn()
        .mockResolvedValue({ _id: USER_ID, email: 'bob@example.com' }),
    };
    walletService = { credit: jest.fn().mockResolvedValue(undefined) };
    blockchainService = {
      hashEmail: jest.fn((email) => `hash-${email}`),
      claimEscrow: jest.fn().mockResolvedValue({ txHash: '0xclaim' }),
      reverseEscrow: jest.fn().mockResolvedValue({ txHash: '0xreverse' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: getModelToken(Transfer.name), useValue: transferModel },
        { provide: UsersService, useValue: usersService },
        { provide: WalletService, useValue: walletService },
        { provide: BlockchainService, useValue: blockchainService },
      ],
    }).compile();

    service = module.get(EscrowService);
  });

  describe('claim', () => {
    it('releases escrowed funds to the claiming user and records a claim transfer', async () => {
      const escrow = buildEscrowDoc();
      transferModel.find
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue([]),
        })
        .mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue([escrow]),
        });

      const result: { claimed: number; transfers: string[] } =
        await service.claim(USER_ID, '1234');

      expect(walletService.credit).toHaveBeenCalledWith(USER_ID, escrow.amount);
      // Settled against the on-chain commitment recorded at deposit time.
      expect(blockchainService.claimEscrow).toHaveBeenCalledWith('escrow-1');
      expect(transferModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TransferType.Claim,
          status: TransferStatus.Completed,
          sender: SENDER_ID,
          recipient: USER_ID,
        }),
      );
      expect(escrow.save).toHaveBeenCalled();
      expect(escrow.status).toBe(TransferStatus.Completed);
      expect(result).toEqual({ claimed: 1, transfers: [ESCROW_ID] });
    });

    it('throws when there are no escrowed funds for the user', async () => {
      transferModel.find
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });

      await expect(service.claim(USER_ID, '1234')).rejects.toThrow(
        'No escrowed funds found for your account',
      );
    });
  });

  describe('reverseExpiredEscrows', () => {
    it('credits the sender and records a reverse transfer for each expired escrow', async () => {
      const expired = buildEscrowDoc({
        escrowExpiry: new Date(Date.now() - 1000),
      });
      transferModel.find.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue([expired]),
      });

      const reversed = await service.reverseExpiredEscrows();

      expect(transferModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TransferStatus.Escrowed,
        }),
      );
      expect(blockchainService.reverseEscrow).toHaveBeenCalledWith(
        'escrow-1',
        expired.amount,
      );
      expect(walletService.credit).toHaveBeenCalledWith(
        SENDER_ID,
        expired.amount,
      );
      expect(transferModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TransferType.Reverse,
          status: TransferStatus.Reversed,
          sender: SENDER_ID,
        }),
      );
      expect(expired.save).toHaveBeenCalled();
      expect(expired.status).toBe(TransferStatus.Reversed);
      expect(reversed).toBe(1);
    });
  });
});
