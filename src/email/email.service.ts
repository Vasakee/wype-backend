import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private from: string;

  constructor(private readonly configService: ConfigService) {
    this.from =
      this.configService.get<string>('RESEND_FROM') ?? 'Wype <onboarding@resend.dev>';
  }

  onModuleInit() {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.logger.log('Resend email provider initialized');
    } else {
      this.logger.warn(
        'RESEND_API_KEY not set — emails will be logged only (mock mode)',
      );
    }
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[mock-email] To: ${to}\nSubject: ${subject}\n\n${body}`);
      return;
    }

    try {
      await this.resend.emails.send({
        from: this.from,
        to: [to],
        subject,
        text: body,
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error as Error);
    }
  }

  async sendHtml(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.log(
        `[mock-email] To: ${to}\nSubject: ${subject}\n\n${text ?? html}`,
      );
      return;
    }

    try {
      await this.resend.emails.send({
        from: this.from,
        to: [to],
        subject,
        html,
        text,
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error as Error);
    }
  }
}
