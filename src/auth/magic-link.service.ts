import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

export interface PendingRegistration {
  email: string;
  fullName?: string;
  phoneNumber?: string;
  passwordHash?: string;
  expiresAt: number;
}

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);
  private readonly pending = new Map<string, PendingRegistration>();

  constructor(private readonly configService: ConfigService) {}

  issue(registration: Omit<PendingRegistration, 'expiresAt'>): {
    token: string;
    link: string;
  } {
    const token = randomBytes(32).toString('hex');
    this.pending.set(token, {
      ...registration,
      expiresAt: Date.now() + MAGIC_LINK_TTL_MS,
    });
    return { token, link: this.buildLink(token) };
  }

  consume(token: string): PendingRegistration | null {
    const registration = this.pending.get(token);
    if (!registration) return null;

    this.pending.delete(token);
    if (Date.now() > registration.expiresAt) return null;

    return registration;
  }

  /**
   * Mock email delivery — logs the link so it is reachable in development.
   * Swap for an SMTP / Resend / SendGrid call once one is wired up.
   */
  sendMagicLink(to: string, link: string): void {
    this.logger.log(`[mock-email] Magic link for ${to}: ${link}`);
  }

  private buildLink(token: string): string {
    const baseUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const url = new URL('/api/auth/verify-magic-link', baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }
}
