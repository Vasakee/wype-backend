import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { UsersService } from '../users/users.service';

export interface RegistrationInitiation {
  registered: boolean;
  codeSent: boolean;
}

export interface RegistrationVerification {
  ok: boolean;
  message: string;
}

interface PendingRegistration {
  email: string;
  code: string;
  expiresAt: number;
}

const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * WhatsApp-native onboarding. A phone number that has never signed up sends its
 * email; verified accounts are linked to the number immediately, otherwise a
 * 6-digit code is emailed that the user replies with to finish registering.
 */
@Injectable()
export class WhatsappAuthService {
  private readonly pending = new Map<string, PendingRegistration>();

  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
  ) {}

  async initiate(from: string, email: string): Promise<RegistrationInitiation> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.usersService.findByEmail(normalized);

    if (existing?.isEmailVerified) {
      await this.usersService.linkPhoneNumber(existing._id.toString(), from);
      return { registered: true, codeSent: false };
    }

    const code = this.generateCode();
    this.pending.set(from, {
      email: normalized,
      code,
      expiresAt: Date.now() + CODE_TTL_MS,
    });

    this.emailService.send(
      normalized,
      'Your Wype verification code',
      `Your Wype verification code is ${code}. Reply with it on WhatsApp to finish registering.`,
    );

    return { registered: false, codeSent: true };
  }

  async verify(from: string, code: string): Promise<RegistrationVerification> {
    const pending = this.pending.get(from);
    if (!pending) {
      return {
        ok: false,
        message:
          'We are not expecting a verification code from this number. Send your email again to start.',
      };
    }
    if (pending.expiresAt < Date.now()) {
      this.pending.delete(from);
      return {
        ok: false,
        message:
          'That code has expired. Send your email again to get a new one.',
      };
    }
    if (pending.code !== code.trim()) {
      return {
        ok: false,
        message:
          'That code does not match. Please check and reply with the 6-digit code we emailed you.',
      };
    }

    this.pending.delete(from);

    const existing = await this.usersService.findByEmail(pending.email);
    if (existing) {
      if (!existing.isEmailVerified) {
        await this.usersService.markEmailVerified(existing._id.toString());
      }
      await this.usersService.linkPhoneNumber(existing._id.toString(), from);
    } else {
      await this.authService.createVerifiedUser({
        email: pending.email,
        phoneNumber: from,
      });
    }

    return { ok: true, message: 'Your account is ready.' };
  }

  private generateCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }
}
