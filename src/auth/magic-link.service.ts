import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { EmailService } from '../email/email.service';

export interface PendingRegistration {
  email: string;
  fullName?: string;
  phoneNumber?: string;
  passwordHash?: string;
  claimToken?: string;
  expiresAt: number;
}

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);
  private readonly pending = new Map<string, PendingRegistration>();

  constructor(
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

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

  async sendMagicLink(to: string, link: string): Promise<void> {
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
        <h2 style="color: #0B3D24; font-size: 20px; font-weight: 700; margin-bottom: 8px;">Sign in to Wype</h2>
        <p style="color: #374151; font-size: 15px; line-height: 1.5;">
          Click the button below to sign in to your Wype account. This link expires in 15 minutes.
        </p>
        <a href="${link}" style="display: inline-block; background: #0B3D24; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0;">
          Sign in to Wype
        </a>
        <p style="color: #9CA3AF; font-size: 13px; line-height: 1.5; margin-top: 24px;">
          If you did not request this, you can safely ignore this email.
        </p>
      </div>
    `;

    const text = `Sign in to Wype\n\nClick the link below to sign in. This link expires in 15 minutes.\n\n${link}\n\nIf you did not request this, you can safely ignore this email.`;

    await this.emailService.sendHtml(to, 'Sign in to Wype', html, text);
  }

  private buildLink(token: string): string {
    const baseUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const url = new URL('/api/auth/verify-magic-link', baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }
}
