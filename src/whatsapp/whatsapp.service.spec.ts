import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { BlipService } from '../blip/blip.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { FeesService } from '../fees/fees.service';
import { TransferService } from '../transfer/transfer.service';
import { UsersService } from '../users/users.service';
import { VoiceService } from '../voice/voice.service';
import { WalletService } from '../wallet/wallet.service';
import { WhatsappAuthService } from './whatsapp-auth.service';
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
  let voiceService: { transcribeVoiceNote: jest.Mock };
  let feesService: { calculate: jest.Mock };
  let walletService: { findByUserId: jest.Mock };
  let whatsappAuth: { initiate: jest.Mock; verify: jest.Mock };

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
    voiceService = { transcribeVoiceNote: jest.fn() };
    feesService = { calculate: jest.fn().mockReturnValue('0.05') };
    walletService = {
      findByUserId: jest.fn().mockResolvedValue({
        balance: '5000000000000000000',
        currency: 'QUAI',
      }),
    };
    whatsappAuth = { initiate: jest.fn(), verify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappService,
        { provide: UsersService, useValue: usersService },
        { provide: TransferService, useValue: transferService },
        { provide: ConfigService, useValue: configService },
        { provide: VoiceService, useValue: voiceService },
        { provide: FeesService, useValue: feesService },
        { provide: WalletService, useValue: walletService },
        { provide: WhatsappAuthService, useValue: whatsappAuth },
        { provide: BlockchainService, useValue: {} },
        { provide: BlipService, useValue: {} },
      ],
    }).compile();

    service = module.get(WhatsappService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('unknown user (WhatsApp onboarding)', () => {
    it('asks an unregistered number for its email', async () => {
      usersService.findByPhoneNumber.mockResolvedValue(null);

      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'Send 5 QUAI to bob@example.com',
      );

      expect(reply).toContain('email address');
    });

    it('links the number immediately when the email is already registered', async () => {
      usersService.findByPhoneNumber.mockResolvedValue(null);
      whatsappAuth.initiate.mockResolvedValue({
        registered: true,
        codeSent: false,
      });

      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'john@example.com',
      );

      expect(whatsappAuth.initiate).toHaveBeenCalledWith(
        WHATSAPP_NUMBER,
        'john@example.com',
      );
      expect(reply).toContain('already registered');
    });

    it('emails a code for a brand new email', async () => {
      usersService.findByPhoneNumber.mockResolvedValue(null);
      whatsappAuth.initiate.mockResolvedValue({
        registered: false,
        codeSent: true,
      });

      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'john@example.com',
      );

      expect(reply).toContain('6-digit code');
    });

    it('rejects an invalid email format', async () => {
      usersService.findByPhoneNumber.mockResolvedValue(null);

      await service.processIncomingMessage(WHATSAPP_NUMBER, 'hello');
      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'not-an-email',
      );

      expect(whatsappAuth.initiate).not.toHaveBeenCalled();
      expect(reply).toContain('not look like a valid email');
    });

    it('finishes registration once the emailed code is confirmed', async () => {
      usersService.findByPhoneNumber.mockResolvedValue(null);
      whatsappAuth.initiate.mockResolvedValue({
        registered: false,
        codeSent: true,
      });
      whatsappAuth.verify.mockResolvedValue({
        ok: true,
        message: 'Your account is ready.',
      });

      await service.processIncomingMessage(WHATSAPP_NUMBER, 'john@example.com');
      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        '123456',
      );

      expect(whatsappAuth.verify).toHaveBeenCalledWith(
        WHATSAPP_NUMBER,
        '123456',
      );
      expect(reply).toContain('set pin');
    });

    it('re-prompts when the verification code is wrong', async () => {
      usersService.findByPhoneNumber.mockResolvedValue(null);
      whatsappAuth.initiate.mockResolvedValue({
        registered: false,
        codeSent: true,
      });
      whatsappAuth.verify.mockResolvedValue({
        ok: false,
        message: 'That code does not match.',
      });

      await service.processIncomingMessage(WHATSAPP_NUMBER, 'john@example.com');
      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        '000000',
      );

      expect(reply).toContain('That code does not match');
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

  describe('help message', () => {
    it('lists the bot capabilities when asked for help', async () => {
      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'help',
      );

      expect(reply).toContain('Here is what I can do');
      expect(reply).toContain('Send 10 QUAI to john@gmail.com');
      expect(reply).toContain('set pin 1234');
      expect(reply).toContain('balance');
    });

    it('shows the help message when a command is not understood', async () => {
      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'hello',
      );

      expect(reply).toContain('did not understand');
      expect(reply).toContain('help');
    });
  });

  describe('balance', () => {
    it('reports the current balance in major units', async () => {
      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'balance',
      );

      expect(walletService.findByUserId).toHaveBeenCalledWith(USER_ID);
      expect(reply).toContain('5 QUAI');
    });

    it('handles a user without a wallet', async () => {
      walletService.findByUserId.mockResolvedValue(null);

      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'my balance',
      );

      expect(reply).toContain('do not have a wallet');
    });
  });

  describe('text send flow', () => {
    it('prompts for a PIN, then completes the transfer on the PIN message', async () => {
      transferService.sendByWhatsapp.mockResolvedValue({ status: 'completed' });

      const prompt = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'Send 10 QUAI to bob@example.com',
      );
      expect(prompt).toContain('Transaction PIN');
      expect(prompt).toContain('0.05 QUAI');

      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        '1234',
      );

      expect(transferService.sendByWhatsapp).toHaveBeenCalledWith(USER_ID, {
        recipientEmail: 'bob@example.com',
        recipientWhatsapp: undefined,
        recipientUsername: undefined,
        amount: '10',
        currency: 'QUAI',
        pin: '1234',
      });
      expect(reply).toContain('was successful');
    });

    it('routes a username recipient through recipientUsername', async () => {
      transferService.sendByWhatsapp.mockResolvedValue({ status: 'completed' });

      await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        'pay 2000 to basil.quai',
      );

      const reply = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        '1234',
      );

      expect(transferService.sendByWhatsapp).toHaveBeenCalledWith(USER_ID, {
        recipientEmail: undefined,
        recipientWhatsapp: undefined,
        recipientUsername: 'basil.quai',
        amount: '2000',
        currency: 'QUAI',
        pin: '1234',
      });
      expect(reply).toContain('2000 QUAI');
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

  describe('voice note flow', () => {
    it('transcribes, confirms amount/recipient/fee and asks for a PIN', async () => {
      voiceService.transcribeVoiceNote.mockResolvedValue(
        'send 10 QUAI to basil.quai',
      );

      const reply = await service.processIncomingMessage(WHATSAPP_NUMBER, '', {
        mediaUrl: 'https://api.twilio.com/media/123',
        mediaContentType: 'audio/ogg',
      });

      expect(voiceService.transcribeVoiceNote).toHaveBeenCalledWith(
        'https://api.twilio.com/media/123',
        'audio/ogg',
      );
      expect(reply).toContain('send 10 QUAI to basil.quai');
      expect(reply).toContain('0.05 QUAI');
      expect(reply).toContain('Transaction PIN');

      transferService.sendByWhatsapp.mockResolvedValue({ status: 'completed' });
      const final = await service.processIncomingMessage(
        WHATSAPP_NUMBER,
        '1234',
      );

      expect(transferService.sendByWhatsapp).toHaveBeenCalledWith(USER_ID, {
        recipientEmail: undefined,
        recipientWhatsapp: undefined,
        recipientUsername: 'basil.quai',
        amount: '10',
        currency: 'QUAI',
        pin: '1234',
      });
      expect(final).toContain('was successful');
    });

    it('politely asks to retry when the transcript is unparseable', async () => {
      voiceService.transcribeVoiceNote.mockResolvedValue('gibberish words');

      const reply = await service.processIncomingMessage(WHATSAPP_NUMBER, '', {
        mediaUrl: 'https://api.twilio.com/media/123',
        mediaContentType: 'audio/ogg',
      });

      expect(reply).toContain('could not make out');
    });

    it('politely asks to retry or type the command when nothing was understood', async () => {
      voiceService.transcribeVoiceNote.mockResolvedValue('');

      const reply = await service.processIncomingMessage(WHATSAPP_NUMBER, '', {
        mediaUrl: 'https://api.twilio.com/media/123',
      });

      expect(reply).toContain('could not understand');
      expect(reply).toContain('type your command');
    });
  });
});
