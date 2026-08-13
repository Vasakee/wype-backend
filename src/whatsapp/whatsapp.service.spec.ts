import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TransferService } from '../transfer/transfer.service';
import { UsersService } from '../users/users.service';
import { WhatsappService } from './whatsapp.service';

const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const WHATSAPP_NUMBER = '+15550000001';

describe('WhatsappService', () => {
  let service: WhatsappService;
  let usersService: {
    findByPhoneNumber: jest.Mock;
    setTransactionPin: jest.Mock;
  };
  let transferService: { sendByWhatsapp: jest.Mock };

  const configService = {
    get: jest.fn(),
    getOrThrow: jest.fn().mockImplementation((key: string) => {
      if (key === 'TWILIO_WHATSAPP_NUMBER') return 'whatsapp:+15550000100';
      throw new Error(`Missing config ${key}`);
    }),
  };

  beforeEach(async () => {
    usersService = {
      findByPhoneNumber: jest.fn().mockResolvedValue({ _id: USER_ID }),
      setTransactionPin: jest.fn().mockResolvedValue({}),
    };
    transferService = { sendByWhatsapp: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappService,
        { provide: UsersService, useValue: usersService },
        { provide: TransferService, useValue: transferService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(WhatsappService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('unknown user', () => {
    it('tells unregistered numbers to create an account', async () => {
      usersService.findByPhoneNumber.mockResolvedValue(null);

      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'Send 5 QUAI to bob@example.com',
      );

      expect(reply).toContain('not registered');
    });
  });

  describe('set pin (one-step)', () => {
    it('sets the pin from a single "set pin 1234" message', async () => {
      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'set pin 1234',
      );

      expect(usersService.setTransactionPin).toHaveBeenCalledWith(
        USER_ID,
        '1234',
      );
      expect(reply).toContain('Transaction PIN has been set');
    });

    it('rejects an invalid pin length', async () => {
      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'set pin 12',
      );

      expect(usersService.setTransactionPin).not.toHaveBeenCalled();
      expect(reply).toContain('not look like a valid PIN');
    });
  });

  describe('set pin (two-step)', () => {
    it('prompts, then sets the pin from the follow-up message', async () => {
      const prompt = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'set pin',
      );
      expect(prompt).toContain('Enter the new 4-digit Transaction PIN');

      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        '4829',
      );

      expect(usersService.setTransactionPin).toHaveBeenCalledWith(
        USER_ID,
        '4829',
      );
      expect(reply).toContain('Transaction PIN has been set');
    });

    it('re-prompts when the follow-up is not a 4-digit number', async () => {
      await service.processIncomingMessage(WHATSAPP_NUMBER, 'set pin');

      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'hello',
      );

      expect(usersService.setTransactionPin).not.toHaveBeenCalled();
      expect(reply).toContain('4-digit');
    });
  });

  describe('send flow', () => {
    it('prompts for a PIN, then completes the transfer on the PIN message', async () => {
      transferService.sendByWhatsapp.mockResolvedValue({ status: 'completed' });

      const prompt = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'Send 10 QUAI to bob@example.com',
      );
      expect(prompt).toContain('Transaction PIN');

      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        '1234',
      );

      expect(transferService.sendByWhatsapp).toHaveBeenCalledWith(USER_ID, {
        recipientEmail: 'bob@example.com',
        recipientWhatsapp: undefined,
        amount: '10',
        currency: 'QUAI',
        pin: '1234',
      });
      expect(reply).toContain('was successful');
    });

    it('gives a friendly message when the PIN is wrong', async () => {
      transferService.sendByWhatsapp.mockRejectedValue(
        new UnauthorizedException(),
      );

      await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'Send 5 QUAI to bob@example.com',
      );

      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        '9999',
      );

      expect(reply).toContain('Invalid Transaction PIN');
    });
  });
});
