import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { Model } from 'mongoose';
import { EmailService } from '../email/email.service';
import {
  MagicLinkToken,
  MagicLinkTokenDocument,
} from './schemas/magic-link-token.schema';

export interface PendingRegistration {
  email: string;
  fullName?: string;
  phoneNumber?: string;
  passwordHash?: string;
  claimToken?: string;
}

@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    @InjectModel(MagicLinkToken.name)
    private readonly tokenModel: Model<MagicLinkTokenDocument>,
  ) {}

  async issue(registration: PendingRegistration): Promise<{
    token: string;
    link: string;
  }> {
    const token = randomBytes(32).toString('hex');
    await this.tokenModel.create({ token, ...registration });
    return { token, link: this.buildLink(token) };
  }

  async consume(token: string): Promise<PendingRegistration | null> {
    const doc = await this.tokenModel.findOneAndDelete({ token }).exec();
    if (!doc) return null;

    return {
      email: doc.email,
      fullName: doc.fullName,
      phoneNumber: doc.phoneNumber,
      passwordHash: doc.passwordHash,
      claimToken: doc.claimToken,
    };
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
    const url = new URL('/auth/callback', baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }
}
