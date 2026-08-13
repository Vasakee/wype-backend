import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';
import { TransferStatus } from '../transfer/schemas/transfer.schema';
import { TransferService } from '../transfer/transfer.service';
import { UsersService } from '../users/users.service';

interface SendIntent {
  amount: string;
  currency: string;
  recipientEmail?: string;
  recipientWhatsapp?: string;
  displayRecipient: string;
}

type WhatsappSession =
  | { state: 'awaiting-pin'; intent: SendIntent; createdAt: number }
  | { state: 'awaiting-new-pin'; createdAt: number };

const SESSION_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private client: twilio.Twilio | null = null;
  private readonly sessions = new Map<string, WhatsappSession>();

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => TransferService))
    private readonly transferService: TransferService,
  ) {}

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

  async processIncomingMessage(from: string, body: string): Promise<string> {
    const user = await this.usersService.findByWhatsappNumber(from);
    if (!user) {
      return 'You are not registered on Wype yet. Create an account and add your WhatsApp number to send money.';
    }

    const session = this.sessions.get(from);
    if (session && this.isExpired(session)) {
      this.sessions.delete(from);
    }

    if (session?.state === 'awaiting-pin') {
      return this.handlePin(from, user._id.toString(), session, body);
    }

    if (session?.state === 'awaiting-new-pin') {
      return this.handleNewPin(from, user._id.toString(), session, body);
    }

    const setPinIntent = this.parseSetPinIntent(body);
    if (setPinIntent) {
      if (setPinIntent.pin) {
        return this.setPinDirect(from, user._id.toString(), setPinIntent.pin);
      }

      this.sessions.set(from, {
        state: 'awaiting-new-pin',
        createdAt: Date.now(),
      });
      return 'Enter the new 4-digit Transaction PIN you want to use.';
    }

    const intent = this.parseSendIntent(body);
    if (!intent) {
      return 'Welcome to Wype! Reply with "Send 10 QUAI to john@gmail.com" to make a payment, or "set pin 1234" to create a Transaction PIN.';
    }

    this.sessions.set(from, {
      state: 'awaiting-pin',
      intent,
      createdAt: Date.now(),
    });

    return 'Please enter your 4-digit Transaction PIN to confirm this payment.';
  }

  private async handlePin(
    from: string,
    userId: string,
    session: Extract<WhatsappSession, { state: 'awaiting-pin' }>,
    body: string,
  ): Promise<string> {
    const pin = body.trim();
    if (!/^\d{4}$/.test(pin)) {
      return 'That does not look like a valid PIN. Reply with your 4-digit Transaction PIN.';
    }

    this.sessions.delete(from);
    const intent = session.intent;

    try {
      const transfer = await this.transferService.sendByWhatsapp(userId, {
        recipientEmail: intent.recipientEmail,
        recipientWhatsapp: intent.recipientWhatsapp,
        amount: intent.amount,
        currency: intent.currency,
        pin,
      });

      return transfer.status === TransferStatus.Escrowed
        ? `Payment of ${intent.amount} ${intent.currency} to ${intent.displayRecipient} is pending. They will receive instructions to claim it.`
        : `Payment of ${intent.amount} ${intent.currency} to ${intent.displayRecipient} was successful.`;
    } catch (error) {
      return this.toFriendlyError(error);
    }
  }

  private async handleNewPin(
    from: string,
    userId: string,
    session: WhatsappSession,
    body: string,
  ): Promise<string> {
    const pin = body.trim();
    if (!/^\d{4}$/.test(pin)) {
      return 'That does not look like a valid PIN. Reply with a 4-digit number.';
    }

    this.sessions.delete(from);
    return this.applyPin(userId, pin);
  }

  private async setPinDirect(
    from: string,
    userId: string,
    pin: string,
  ): Promise<string> {
    if (!/^\d{4}$/.test(pin)) {
      return 'That does not look like a valid PIN. Use the format "set pin 1234".';
    }

    return this.applyPin(userId, pin);
  }

  private async applyPin(userId: string, pin: string): Promise<string> {
    try {
      await this.usersService.setTransactionPin(userId, pin);
      return 'Your Transaction PIN has been set. Reply with "Send 10 QUAI to john@gmail.com" to make a payment.';
    } catch (error) {
      this.logger.error('Failed to set PIN via WhatsApp', error as Error);
      return 'Something went wrong while setting your PIN. Please try again later.';
    }
  }

  private parseSetPinIntent(body: string): { pin?: string } | null {
    const match = body
      .trim()
      .match(/^(?:set|setup|change)\s+pin(?:\s+(\d+))?$/i);
    if (!match) return null;
    return { pin: match[1] };
  }

  private parseSendIntent(body: string): SendIntent | null {
    const match = body
      .trim()
      .match(/^send\s+(\d+(?:[.,]\d+)?)\s*([a-z]{3,5})?\s+to\s+(.+)$/i);
    if (!match) return null;

    const amount = match[1].replace(',', '.');
    const currency = (match[2] ?? 'QUAI').toUpperCase();
    const recipient = match[3].trim();

    if (!amount || !recipient) return null;

    const isEmail = recipient.includes('@');
    return {
      amount,
      currency,
      recipientEmail: isEmail ? recipient : undefined,
      recipientWhatsapp: isEmail ? undefined : recipient,
      displayRecipient: recipient,
    };
  }

  private toFriendlyError(error: unknown): string {
    if (error instanceof UnauthorizedException) {
      return 'Invalid Transaction PIN. Please start again and try once more.';
    }
    if (error instanceof BadRequestException) {
      return `Sorry, the payment was not completed: ${error.message}`;
    }
    if (error instanceof NotFoundException) {
      return 'The payment could not be completed: recipient not found.';
    }
    this.logger.error('WhatsApp transfer failed', error as Error);
    return 'Something went wrong while processing your payment. Please try again later.';
  }

  private isExpired(session: WhatsappSession): boolean {
    return Date.now() - session.createdAt > SESSION_TTL_MS;
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
