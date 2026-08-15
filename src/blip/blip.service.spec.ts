import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { BlipService } from './blip.service';

const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const USER = { _id: USER_ID, walletAddress: `0x${'cd'.repeat(20)}` };

describe('BlipService', () => {
  let service: BlipService;
  let usersService: { findById: jest.Mock };
  let walletService: { credit: jest.Mock };
  let movementModel: { create: jest.Mock; findOne: jest.Mock };
  let fetchMock: jest.Mock;

  const configService = {
    get: jest.fn().mockReturnValue('https://blippay.me'),
  };

  function jsonResponse(body: unknown): Response {
    return {
      ok: true,
      json: jest.fn().mockResolvedValue(body),
    } as unknown as Response;
  }

  beforeEach(async () => {
    usersService = { findById: jest.fn().mockResolvedValue(USER) };
    walletService = { credit: jest.fn().mockResolvedValue({}) };
    movementModel = {
      create: jest.fn().mockResolvedValue({
        _id: { toString: () => 'movId' },
      }),
      findOne: jest.fn(),
    };

    fetchMock = jest.fn();
    global.fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlipService,
        { provide: UsersService, useValue: usersService },
        { provide: WalletService, useValue: walletService },
        { provide: ConfigService, useValue: configService },
        { provide: getModelToken('Movement'), useValue: movementModel },
      ],
    }).compile();

    service = module.get(BlipService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startFunding', () => {
    it('creates a pending funding movement and returns an invoice link', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ session_id: 'cs_1', invoice_ref: 'inv_1' }),
      );

      const result = await service.startFunding(USER_ID, {
        amountCents: 2500,
        customerEmail: 'user@example.com',
      });

      const [checkoutUrl, checkoutInit] = fetchMock.mock.calls[0] as [
        string,
        { body: string },
      ];
      expect(checkoutUrl).toBe(
        'https://blippay.me/api/ramp/managed-quai/checkout',
      );
      expect(JSON.parse(checkoutInit.body)).toEqual({
        address: USER.walletAddress,
        amount_cents: 2500,
        customer_email: 'user@example.com',
      });
      expect(movementModel.create).toHaveBeenCalledTimes(1);
      expect(result.invoiceUrl).toContain('/fund/invoice');
      expect(result.invoiceUrl).toContain(`q=${USER.walletAddress}`);
      expect(result.statusUrl).toBe('/api/blip/fund/cs_1');
    });

    it('requires a self-custody wallet', async () => {
      usersService.findById.mockResolvedValue({
        _id: USER_ID,
        walletAddress: null,
      });

      await expect(
        service.startFunding(USER_ID, { amountCents: 100 }),
      ).rejects.toThrow(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('completeFunding', () => {
    it('credits the ledger and converts to wallet once funded', async () => {
      const movement = {
        _id: { toString: () => 'movId' },
        status: 'pending',
        invoiceRef: 'inv_1',
        amountCents: 2500,
        txHash: undefined,
        save: jest.fn().mockResolvedValue({}),
      };
      movementModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(movement),
      });
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ status: 'paid' }))
        .mockResolvedValueOnce(jsonResponse({ tx_hash: '0xabc' }))
        .mockResolvedValueOnce(jsonResponse({ usd: 10 }));

      const result = await service.completeFunding(USER_ID, 'cs_1');

      expect(walletService.credit).toHaveBeenCalledWith(
        USER_ID,
        '2500000000000000000',
      );
      expect(movement.status).toBe('completed');
      expect(movement.txHash).toBe('0xabc');
      expect(result.status).toBe('completed');
      expect(result.amountCredited).toBe('2500000000000000000');
    });

    it('returns pending when the session is not funded yet', async () => {
      movementModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: { toString: () => 'movId' },
          status: 'pending',
          invoiceRef: 'inv_1',
          amountCents: 100,
          txHash: undefined,
          save: jest.fn(),
        }),
      });
      fetchMock.mockResolvedValue(jsonResponse({ status: 'pending' }));

      const result = await service.completeFunding(USER_ID, 'cs_1');

      expect(result.status).toBe('pending');
      expect(walletService.credit).not.toHaveBeenCalled();
    });

    it('throws when the session is not found', async () => {
      movementModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.completeFunding(USER_ID, 'cs_x')).rejects.toThrow(
        NotFoundException,
      );
      expect(walletService.credit).not.toHaveBeenCalled();
    });
  });
});
