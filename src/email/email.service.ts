import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private from: string;

  constructor(private readonly configService: ConfigService) {
    this.from =
      this.configService.get<string>('GMAIL_USER') ?? 'basildayigil@gmail.com';
  }

  onModuleInit() {
    const user = this.configService.get<string>('GMAIL_USER');
    const pass = this.configService.get<string>('GMAIL_APP_PASSWORD');

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user, pass },
      });
      this.logger.log('Gmail SMTP email provider initialized');
    } else {
      this.logger.warn(
        'GMAIL_USER / GMAIL_APP_PASSWORD not set — emails will be logged only (mock mode)',
      );
    }
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[mock-email] To: ${to}\nSubject: ${subject}\n\n${body}`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
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
    if (!this.transporter) {
      this.logger.log(
        `[mock-email] To: ${to}\nSubject: ${subject}\n\n${text ?? html}`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
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
