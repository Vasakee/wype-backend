import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private client: twilio.Twilio | null = null;

  constructor(private readonly configService: ConfigService) {}

  async sendMessage(to: string, body: string) {
    const client = this.getClient();
    const fromNumber = this.configService.getOrThrow<string>(
      'TWILIO_WHATSAPP_NUMBER',
    );

    const message = await client.messages.create({
      from: `whatsapp:${fromNumber}`,
      to: this.normalizeNumber(to),
      body,
    });

    this.logger.log(`WhatsApp message sent to ${to}: ${message.sid}`);
    return message;
  }

  private getClient(): twilio.Twilio {
    if (!this.client) {
      this.client = twilio(
        this.configService.getOrThrow<string>('TWILIO_ACCOUNT_SID'),
        this.configService.getOrThrow<string>('TWILIO_AUTH_TOKEN'),
      );
    }
    return this.client;
  }

  private normalizeNumber(to: string): string {
    return to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  }
}
