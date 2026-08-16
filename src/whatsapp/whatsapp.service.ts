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
import { FeesService } from '../fees/fees.service';
import { TransferStatus } from '../transfer/schemas/transfer.schema';
import { fromMinorUnits } from '../transfer/units';
import { TransferService } from '../transfer/transfer.service';
import { UsersService } from '../users/users.service';
import { VoiceService } from '../voice/voice.service';
import { WalletService } from '../wallet/wallet.service';
import { WhatsappAuthService } from './whatsapp-auth.service';

export interface IncomingMedia {
  mediaUrl?: string;
  mediaContentType?: string;
}

interface SendIntent {
  amount: string;
  currency: string;
  recipientEmail?: string;
  recipientWhatsapp?: string;
  recipientUsername?: string;
  displayRecipient: string;
  fee: string;
}

type WhatsappSession =
  | { state: 'awaiting-pin'; intent: SendIntent; createdAt: number }
  | { state: 'awaiting-new-pin'; createdAt: number }
  | { state: 'awaiting-email'; createdAt: number }
  | { state: 'awaiting-verification'; email: string; createdAt: number };

interface PhoneLinkChallenge {
  phone: string;
  code: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 10 * 60 * 1000;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private client: twilio.Twilio | null = null;
  private readonly sessions = new Map<string, WhatsappSession>();
  private readonly linkChallenges = new Map<string, PhoneLinkChallenge>();

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly voiceService: VoiceService,
    private readonly feesService: FeesService,
    private readonly walletService: WalletService,
    private readonly whatsappAuth: WhatsappAuthService,
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

  /**
   * Web flow for linking a WhatsApp number: mails a 6-digit code to the number
   * via the bot, which the user then echoes back in the app to verify.
   */
  async linkStart(userId: string, rawPhone: string) {
    const phone = rawPhone.replace(/[\s()-]/g, '');
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      throw new BadRequestException(
        'Enter a valid phone number in international format, e.g. +14155552671',
      );
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.linkChallenges.set(userId, {
      phone,
      code,
      expiresAt: Date.now() + LINK_CODE_TTL_MS,
    });

    this.logger.log(
      `[mock-whatsapp] Link code for ${phone}: ${code} (user ${userId})`,
    );

    await this.sendMessage(
      phone,
      `Your Wype verification code is ${code}. Reply with it in the Wype app to link this number.`,
    ).catch(() => undefined);

    return { ok: true, cooldownSeconds: 30 };
  }

  async linkVerify(userId: string, rawPhone: string, code: string) {
    const phone = rawPhone.replace(/[\s()-]/g, '');
    const challenge = this.linkChallenges.get(userId);

    if (!challenge || challenge.phone !== phone || challenge.code !== code) {
      throw new UnauthorizedException('That code is incorrect');
    }
    if (challenge.expiresAt < Date.now()) {
      this.linkChallenges.delete(userId);
      throw new BadRequestException(
        'That code has expired. Request a new one.',
      );
    }

    this.linkChallenges.delete(userId);
    await this.usersService.linkPhoneNumber(userId, challenge.phone);

    return { ok: true, linkedPhone: challenge.phone };
  }

  async unlink(userId: string) {
    await this.usersService.unlinkPhoneNumber(userId);
    return { ok: true };
  }

  async processIncomingMessage(
    from: string,
    body: string,
    media?: IncomingMedia,
  ): Promise<string> {
    const session = this.sessions.get(from);
    if (session && this.isExpired(session)) {
      this.sessions.delete(from);
    }

    const user = await this.usersService.findByPhoneNumber(from);
    if (!user) {
      return this.handleUnregistered(from, body, session);
    }

    if (media?.mediaUrl) {
      return this.handleVoiceNote(from, user._id.toString(), media);
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

    if (/^(help|menu|start)$/i.test(body.trim())) {
      return this.buildHelpMessage();
    }

    if (/^(balance|my balance|check balance)$/i.test(body.trim())) {
      return this.handleBalance(user._id.toString());
    }

    const intent = this.parseTransferIntent(body);
    if (!intent) {
      return this.buildHelpMessage();
    }

    this.sessions.set(from, {
      state: 'awaiting-pin',
      intent,
      createdAt: Date.now(),
    });

    return this.buildConfirmation(intent);
  }

  private async handleUnregistered(
    from: string,
    body: string,
    session: WhatsappSession | undefined,
  ): Promise<string> {
    if (session?.state === 'awaiting-email') {
      return this.handleRegistrationEmail(from, body);
    }

    if (session?.state === 'awaiting-verification') {
      return this.handleVerificationCode(from, body);
    }

    if (EMAIL_PATTERN.test(body.trim())) {
      return this.handleRegistrationEmail(from, body);
    }

    this.sessions.set(from, {
      state: 'awaiting-email',
      createdAt: Date.now(),
    });
    return 'Welcome to Wype! Reply with the email address you use (or want to use) on Wype, and we will link it to this WhatsApp number.';
  }

  private async handleRegistrationEmail(
    from: string,
    body: string,
  ): Promise<string> {
    const email = body.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      return 'That does not look like a valid email. Please reply with your email address, e.g. john@email.com.';
    }

    try {
      const result = await this.whatsappAuth.initiate(from, email);

      if (result.registered) {
        this.sessions.delete(from);
        return `You are already registered with ${email}. Your WhatsApp number is now linked. Reply with "set pin 1234" to create a Transaction PIN, or send money like "Send 10 QUAI to basil.quai".`;
      }
    } catch (error) {
      this.logger.error(
        'WhatsApp registration initiation failed',
        error as Error,
      );
      return 'Sorry, something went wrong. Please reply with your email address to try again.';
    }

    this.sessions.set(from, {
      state: 'awaiting-verification',
      email,
      createdAt: Date.now(),
    });
    return `We sent a 6-digit code to ${email}. Reply with the code here to finish registering.`;
  }

  private async handleVerificationCode(
    from: string,
    body: string,
  ): Promise<string> {
    const result = await this.whatsappAuth.verify(from, body.trim());
    if (!result.ok) {
      return result.message;
    }

    this.sessions.delete(from);
    return `${result.message} Reply with "set pin 1234" to create your Transaction PIN, or send money like "Send 10 QUAI to basil.quai".`;
  }

  private async handleVoiceNote(
    from: string,
    userId: string,
    media: IncomingMedia,
  ): Promise<string> {
    let transcript = '';
    try {
      transcript = await this.voiceService.transcribeVoiceNote(
        media.mediaUrl as string,
        media.mediaContentType,
      );
    } catch (error) {
      this.logger.error('Voice note transcription failed', error as Error);
    }

    const text = transcript.trim().toLowerCase();
    if (!text) {
      return 'Sorry, I could not understand your voice note. Please try again, or type your command like "Send 10 QUAI to john@email.com".';
    }

    const intent = this.parseTransferIntent(text);
    if (!intent) {
      return 'I could not make out an amount and a recipient in your voice note. Please try again, or type your command like "Send 10 QUAI to john@email.com".';
    }

    this.sessions.set(from, {
      state: 'awaiting-pin',
      intent,
      createdAt: Date.now(),
    });

    return this.buildConfirmation(intent);
  }

  private buildConfirmation(intent: SendIntent): string {
    return `Got it — send ${intent.amount} ${intent.currency} to ${intent.displayRecipient}? A fee of ${intent.fee} ${intent.currency} applies. Reply with your 4-digit Transaction PIN to confirm.`;
  }

  private async handleBalance(userId: string): Promise<string> {
    try {
      const wallet = await this.walletService.findByUserId(userId);
      if (!wallet) {
        return 'You do not have a wallet yet. Send money first or fund it from the app, then reply "balance" again.';
      }
      const balance = fromMinorUnits(wallet.balance);
      return `Your current balance is ${balance} ${wallet.currency}. Reply "Send 10 QUAI to john@gmail.com" to make a payment.`;
    } catch (error) {
      this.logger.error('Balance lookup failed', error as Error);
      return 'Something went wrong while checking your balance. Please try again later.';
    }
  }

  private buildHelpMessage(): string {
    return [
      '👋 Welcome to Wype! Here is what I can do:',
      '',
      '💸 Send money',
      '   Send 10 QUAI to john@gmail.com',
      '   (recipient: email, phone number, or username like basil.quai)',
      '',
      '🎤 Send money by voice',
      '   Record a voice note saying "send 10 QUAI to basil.quai"',
      '',
      '💰 View your balance',
      '   Reply "balance"',
      '',
      '🔒 Set or change your Transaction PIN',
      '   set pin 1234',
      '',
      '🔄 Off-ramp to fiat',
      '   Coming soon — not available yet',
      '',
      'Reply with any command above to get started.',
    ].join('\n');
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
        recipientUsername: intent.recipientUsername,
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

  /**
   * Parses "send 10 QUAI to <recipient>" / "pay 2000 to <recipient>" text.
   * The recipient can be an email, a phone number, or a Wype username.
   */
  private parseTransferIntent(body: string): SendIntent | null {
    const match = body
      .trim()
      .match(/^(?:send|pay)\s+(\d+(?:[.,]\d+)?)\s*([a-z]{3,5})?\s+to\s+(.+)$/i);
    if (!match) return null;

    const amount = match[1].replace(',', '.');
    const currency = (match[2] ?? 'QUAI').toUpperCase();
    const recipient = match[3].trim();

    if (!amount || !recipient) return null;

    if (recipient.includes('@')) {
      return {
        amount,
        currency,
        recipientEmail: recipient,
        displayRecipient: recipient,
        fee: this.feesService.calculate(amount),
      };
    }

    if (/^\+?[\d\s-]{7,}$/.test(recipient)) {
      return {
        amount,
        currency,
        recipientWhatsapp: recipient,
        displayRecipient: recipient,
        fee: this.feesService.calculate(amount),
      };
    }

    return {
      amount,
      currency,
      recipientUsername: recipient,
      displayRecipient: recipient,
      fee: this.feesService.calculate(amount),
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
