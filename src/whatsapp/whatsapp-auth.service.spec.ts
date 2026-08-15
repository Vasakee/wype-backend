import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { UsersService } from '../users/users.service';
import { WhatsappAuthService } from './whatsapp-auth.service';

const PHONE = '+15550000001';

describe('WhatsappAuthService', () => {
  let service: WhatsappAuthService;
  let usersService: {
    findByEmail: jest.Mock;
    linkPhoneNumber: jest.Mock;
    markEmailVerified: jest.Mock;
  };
  let authService: { createVerifiedUser: jest.Mock };
  let emailService: { send: jest.Mock };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn().mockResolvedValue(null),
      linkPhoneNumber: jest.fn().mockResolvedValue({}),
      markEmailVerified: jest.fn().mockResolvedValue({}),
    };
    authService = { createVerifiedUser: jest.fn().mockResolvedValue({}) };
    emailService = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappAuthService,
        { provide: UsersService, useValue: usersService },
        { provide: AuthService, useValue: authService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get(WhatsappAuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initiate', () => {
    it('links the number to an already-registered verified account', async () => {
      usersService.findByEmail.mockResolvedValue({
        _id: 'userId',
        isEmailVerified: true,
      });

      const result = await service.initiate(PHONE, 'JOHN@Example.com');

      expect(usersService.findByEmail).toHaveBeenCalledWith('john@example.com');
      expect(usersService.linkPhoneNumber).toHaveBeenCalledWith(
        'userId',
        PHONE,
      );
      expect(result).toEqual({ registered: true, codeSent: false });
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('emails a 6-digit code for an unknown email', async () => {
      const result = await service.initiate(PHONE, 'john@example.com');

      expect(result).toEqual({ registered: false, codeSent: true });
      expect(emailService.send).toHaveBeenCalledTimes(1);
      const [to, subject, body] = emailService.send.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(to).toBe('john@example.com');
      expect(subject).toBe('Your Wype verification code');
      expect(body).toMatch(/\d{6}/);
    });
  });

  describe('verify', () => {
    it('creates a verified account for a new email when the code matches', async () => {
      await service.initiate(PHONE, 'john@example.com');
      const [, , body] = emailService.send.mock.calls[0] as [
        string,
        string,
        string,
      ];
      const code = body.match(/\d{6}/)?.[0] as string;

      const result = await service.verify(PHONE, code);

      expect(authService.createVerifiedUser).toHaveBeenCalledWith({
        email: 'john@example.com',
        phoneNumber: PHONE,
      });
      expect(usersService.linkPhoneNumber).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it('verifies and links an existing unverified account', async () => {
      usersService.findByEmail.mockResolvedValue({
        _id: 'userId',
        isEmailVerified: false,
      });
      await service.initiate(PHONE, 'john@example.com');
      const [, , body] = emailService.send.mock.calls[0] as [
        string,
        string,
        string,
      ];
      const code = body.match(/\d{6}/)?.[0] as string;

      const result = await service.verify(PHONE, code);

      expect(usersService.markEmailVerified).toHaveBeenCalledWith('userId');
      expect(usersService.linkPhoneNumber).toHaveBeenCalledWith(
        'userId',
        PHONE,
      );
      expect(authService.createVerifiedUser).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it('rejects a wrong code without creating an account', async () => {
      await service.initiate(PHONE, 'john@example.com');

      const result = await service.verify(PHONE, '000000');

      expect(result.ok).toBe(false);
      expect(authService.createVerifiedUser).not.toHaveBeenCalled();
      expect(usersService.linkPhoneNumber).not.toHaveBeenCalled();
    });
  });
});
