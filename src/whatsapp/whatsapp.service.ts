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
import { BlipService } from '../blip/blip.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { FeesService } from '../fees/fees.service';
import { RequestService } from '../request/request.service';
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

const copy = {
  en: {
    welcome:
      'Welcome to Wype! Reply with the email address you use (or want to use) on Wype, and we will link it to this WhatsApp number.',
    emailPrompt:
      'Reply with the email address you use (or want to use) on Wype.',
    invalidEmail: 'That does not look like a valid email. Please reply with your email address, e.g. john@email.com.',
    codeSent: (email: string) =>
      `We sent a 6-digit code to ${email}. Reply with the code here to finish registering.`,
    alreadyRegistered: (email: string) =>
      `You are already registered with ${email}. Your WhatsApp number is now linked. Reply with "set pin 1234" to create a Transaction PIN, or send money like "Send 10 QUAI to basil.quai".`,
    registrationComplete: (msg: string) =>
      `${msg} Reply with "set pin 1234" to create your Transaction PIN, or send money like "Send 10 QUAI to basil.quai".`,
    invalidCode: 'That code does not match. Please check and reply with the 6-digit code we emailed you.',
    codeExpired: 'That code has expired. Send your email again to get a new one.',
    noSession: 'We are not expecting a verification code from this number. Send your email again to start.',
    regError: 'Sorry, something went wrong. Please reply with your email address to try again.',
    balance: (amount: string, currency: string, fiat?: string) =>
      `Your current balance is ${amount} ${currency}${fiat ? ` (≈ ${fiat})` : ''}. Reply "Send 10 QUAI to john@gmail.com" to make a payment.`,
    noWallet:
      'You do not have a wallet yet. Reply "create wallet" to set one up, or "fund" to add money.',
    walletCreated: (address: string) =>
      `Your wallet has been created.\nAddress: ${address}\nReply "fund" to add money, or "Send 10 QUAI to john@gmail.com" to make a payment.`,
    walletExists: (address: string) =>
      `You already have a wallet.\nAddress: ${address}`,
    fundPrompt:
      'How much do you want to fund? Reply with an amount in USD, e.g. "fund 10" to add $10 worth of QUAI.',
    fundLink: (amount: string, link: string) =>
      `Here is your Blip Pay link to add $${amount} of QUAI:\n${link}\nOnce payment is complete, your balance will update automatically.`,
    fundError:
      'Could not start funding. Please try again later or fund from the app.',
    quote: (amount: string, currency: string, fee: string, total: string, mode: string, expiry?: string) =>
      [
        `Quote for sending ${amount} ${currency}:`,
        `Fee: ${fee} ${currency}`,
        `Total deducted: ${total} ${currency}`,
        `Routing: ${mode === 'direct' ? 'Direct transfer (instant)' : `Escrow${expiry ? ` (${expiry} days to claim)` : ''}`}`,
      ].join('\n'),
    invalidQuote: 'Usage: quote <amount> to <email>\nExample: quote 10 to john@email.com',
    pinSet:
      'Your Transaction PIN has been set. Reply with "Send 10 QUAI to john@gmail.com" to make a payment.',
    pinError:
      'Something went wrong while setting your PIN. Please try again later.',
    invalidPin: 'That does not look like a valid PIN. Reply with your 4-digit Transaction PIN.',
    pinConfirm: (amount: string, currency: string, recipient: string, fee: string) =>
      `Got it — send ${amount} ${currency} to ${recipient}? A fee of ${fee} ${currency} applies. Reply with your 4-digit Transaction PIN to confirm.`,
    sendSuccess: (amount: string, currency: string, recipient: string) =>
      `Payment of ${amount} ${currency} to ${recipient} was successful.`,
    sendEscrowed: (amount: string, currency: string, recipient: string) =>
      `Payment of ${amount} ${currency} to ${recipient} is pending. They will receive instructions to claim it.`,
    sendError:
      'Something went wrong while processing your payment. Please try again later.',
    invalidSend:
      'Sorry, I could not understand that. Try "Send 10 QUAI to john@email.com".',
    langSet: (lang: string) =>
      `Language set to ${lang === 'en' ? 'English' : 'Pidgin'}.`,
    langInvalid: 'Reply with "language en" for English or "language pcm" for Pidgin.',
    voiceUnreadable:
      'Sorry, I could not understand your voice note. Please try again, or type your command like "Send 10 QUAI to john@email.com".',
    voiceNoIntent:
      'I could not make out an amount and a recipient in your voice note. Please try again, or type your command like "Send 10 QUAI to john@email.com".',
    voiceTranscribeError:
      'Sorry, I could not understand your voice note. Please try again, or type your command.',
    unknownCommand: 'Sorry, I did not understand that. Reply "help" to see what I can do.',
    pinNewPrompt: 'Enter the new 4-digit Transaction PIN you want to use.',
    pinNewInvalid: 'That does not look like a valid PIN. Reply with a 4-digit number.',
    pinInvalidDirect: 'That does not look like a valid PIN. Use the format "set pin 1234".',
    pinVerifyPrompt: 'Enter current PIN to verify your identity',
    pinChangeSuccess: 'Your Transaction PIN has been updated.',
    pinChangeError: 'Could not change PIN. Make sure your current PIN is correct.',
    historyEmpty: 'No transactions yet. Send your first payment with "Send 10 QUAI to john@email.com".',
    historyItem: (direction: string, email: string, amount: string, currency: string, status: string) =>
      `${direction === 'out' ? '↑ Sent' : '↓ Received'} ${amount} ${currency} ${direction === 'out' ? 'to' : 'from'} ${email} • ${status}`,
    historyHeader: (count: number) => `📋 Last ${count} transaction${count === 1 ? '' : 's'}:`,
    requestPrompt: 'Who do you want to request money from? Reply with their email, e.g. "request 10 from john@email.com".',
    requestCreated: (amount: string, currency: string, email: string) =>
      `Request for ${amount} ${currency} from ${email} has been sent.`,
    requestError: 'Could not create request. Make sure the email is valid and try again.',
    requestNoRecipient: 'Please include who to request from, e.g. "request 10 from john@email.com".',
  },
  pcm: {
    welcome:
      'Welcome to Wype! Reply with the email wey you dey use (or wan use) for Wype, and we go link am to this WhatsApp number.',
    emailPrompt:
      'Reply with the email wey you dey use (or wan use) for Wype.',
    invalidEmail: 'That email no correct. Please reply with your email, e.g. john@email.com.',
    codeSent: (email: string) =>
      `We don send 6-digit code to ${email}. Reply with the code here to finish registration.`,
    alreadyRegistered: (email: string) =>
      `You don already register with ${email}. Your WhatsApp number don link. Reply "set pin 1234" create Transaction PIN, or send money like "Send 10 QUAI to basil.quai".`,
    registrationComplete: (msg: string) =>
      `${msg} Reply "set pin 1234" create your Transaction PIN, or send money like "Send 10 QUAI to basil.quai".`,
    invalidCode: 'That code no match. Check well and reply with the 6-digit code wey we email you.',
    codeExpired: 'That code don expire. Send your email again make you get new one.',
    noSession: 'We no dey expect code from this number. Send your email again make we start.',
    regError: 'Sorry, something go wrong. Please reply with your email address try again.',
    balance: (amount: string, currency: string, fiat?: string) =>
      `Your balance na ${amount} ${currency}${fiat ? ` (≈ ${fiat})` : ''}. Reply "Send 10 QUAI to john@gmail.com" make you send money.`,
    noWallet:
      'You no get wallet yet. Reply "create wallet" set am up, or "fund" add money.',
    walletCreated: (address: string) =>
      `Your wallet don ready.\nAddress: ${address}\nReply "fund" add money, or "Send 10 QUAI to john@gmail.com" send money.`,
    walletExists: (address: string) =>
      `You don get wallet already.\nAddress: ${address}`,
    fundPrompt:
      'How much you wan fund? Reply with amount for USD, e.g. "fund 10" to add $10 worth of QUAI.',
    fundLink: (amount: string, link: string) =>
      `Here be your Blip Pay link to add $${amount} of QUAI:\n${link}\nOnce payment complete, your balance go update.`,
    fundError:
      'E no fit start funding. Please try again later or fund from the app.',
    quote: (amount: string, currency: string, fee: string, total: string, mode: string, expiry?: string) =>
      [
        `Quote for sending ${amount} ${currency}:`,
        `Fee: ${fee} ${currency}`,
        `Total wey go comot: ${total} ${currency}`,
        `Route: ${mode === 'direct' ? 'Direct transfer (instant)' : `Escrow${expiry ? ` (${expiry} days to claim)` : ''}`}`,
      ].join('\n'),
    invalidQuote: 'Usage: quote <amount> to <email>\nExample: quote 10 to john@email.com',
    pinSet:
      'Your Transaction PIN don set. Reply "Send 10 QUAI to john@email.com" make you send money.',
    pinError:
      'E no fit set your PIN. Please try again later.',
    invalidPin: 'That no be valid PIN. Reply with your 4-digit Transaction PIN.',
    pinConfirm: (amount: string, currency: string, recipient: string, fee: string) =>
      `Oya — send ${amount} ${currency} to ${recipient}? Fee of ${fee} ${currency} go apply. Reply with your 4-digit Transaction PIN confirm.`,
    sendSuccess: (amount: string, currency: string, recipient: string) =>
      `Payment of ${amount} ${currency} to ${recipient} don successful.`,
    sendEscrowed: (amount: string, currency: string, recipient: string) =>
      `Payment of ${amount} ${currency} to ${recipient} dey pending. Dem go receive instruction to claim am.`,
    sendError:
      'Something go wrong wey we dey process your payment. Please try again later.',
    invalidSend:
      'Sorry, I no understand. Try "Send 10 QUAI to john@email.com".',
    langSet: (lang: string) =>
      `Language don set to ${lang === 'en' ? 'English' : 'Pidgin'}.`,
    langInvalid: 'Reply "language en" for English or "language pcm" for Pidgin.',
    voiceUnreadable:
      'Sorry, I no understand your voice note. Please try again, or type your command like "Send 10 QUAI to john@email.com".',
    voiceNoIntent:
      'I no fit find amount and recipient for your voice note. Please try again, or type your command like "Send 10 QUAI to john@email.com".',
    voiceTranscribeError:
      'Sorry, I no understand your voice note. Please try again, or type your command.',
    unknownCommand: 'Sorry, I no understand wetin you type. Reply "help" make you see wetin I fit do.',
    pinNewPrompt: 'Put the new 4-digit Transaction PIN wey you wan use.',
    pinNewInvalid: 'That no be valid PIN. Reply with a 4-digit number.',
    pinInvalidDirect: 'That no be valid PIN. Use "set pin 1234".',
    pinVerifyPrompt: 'Put current PIN make we know say na you',
    pinChangeSuccess: 'Your Transaction PIN don update.',
    pinChangeError: 'E no fit change PIN. Make sure your current PIN correct.',
    historyEmpty: 'No transaction yet. Send your first payment with "Send 10 QUAI to john@email.com".',
    historyItem: (direction: string, email: string, amount: string, currency: string, status: string) =>
      `${direction === 'out' ? '↑ You send' : '↓ You receive'} ${amount} ${currency} ${direction === 'out' ? 'to' : 'from'} ${email} • ${status}`,
    historyHeader: (count: number) => `📋 Last ${count} transaction${count === 1 ? '' : 's'}:`,
    requestPrompt: 'Who you wan request money from? Reply with their email, e.g. "request 10 from john@email.com".',
    requestCreated: (amount: string, currency: string, email: string) =>
      `Request for ${amount} ${currency} from ${email} don send.`,
    requestError: 'E no fit create request. Make sure the email correct try again.',
    requestNoRecipient: 'Abeg include who you wan request from, e.g. "request 10 from john@email.com".',
  },
} as const;

type CopyKey = keyof (typeof copy)['en'];

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
    private readonly blockchainService: BlockchainService,
    private readonly blipService: BlipService,
    private readonly requestService: RequestService,
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
      // Block voice notes from unregistered users
      if (media?.mediaUrl) {
        return 'Please register first. Reply with your email address to create an account.';
      }
      return this.handleUnregistered(from, body, session);
    }

    const lang = (user.lang as 'en' | 'pcm') ?? 'en';
    const c = copy[lang];

    if (media?.mediaUrl) {
      return this.handleVoiceNote(from, user._id.toString(), media, lang);
    }

    if (session?.state === 'awaiting-pin') {
      return this.handlePin(from, user._id.toString(), session, body, lang);
    }

    if (session?.state === 'awaiting-new-pin') {
      return this.handleNewPin(from, user._id.toString(), session, body, lang);
    }

    const trimmed = body.trim();

    // ── Set / change PIN ──
    const setPinIntent = this.parseSetPinIntent(trimmed);
    if (setPinIntent) {
      if (setPinIntent.pin) {
        return this.setPinDirect(from, user._id.toString(), setPinIntent.pin, lang);
      }
      this.sessions.set(from, {
        state: 'awaiting-new-pin',
        createdAt: Date.now(),
      });
      return c.pinNewPrompt;
    }

    // ── Help ──
    if (/^(help|menu|start)$/i.test(trimmed)) {
      return this.buildHelpMessage(lang);
    }

    // ── Balance ──
    if (/^(balance|my balance|check balance)$/i.test(trimmed)) {
      return this.handleBalance(user._id.toString(), lang);
    }

    // ── Wallet ──
    if (/^(create\s+wallet|wallet)$/i.test(trimmed)) {
      return this.handleCreateWallet(user._id.toString(), lang);
    }

    // ── Fund ──
    const fundMatch = trimmed.match(/^fund(?:\s+(\d+(?:\.\d+)?))?$/i);
    if (fundMatch) {
      return this.handleFund(user._id.toString(), fundMatch[1], lang);
    }

    // ── Quote ──
    const quoteMatch = trimmed.match(
      /^(?:quote|fee)\s+(?:send\s+)?(\d+(?:[.,]\d+)?)\s*(?:([a-z]{3,5})\s+)?to\s+(.+)$/i,
    );
    if (quoteMatch) {
      return this.handleQuote(
        user._id.toString(),
        quoteMatch[1],
        quoteMatch[2]?.toUpperCase() ?? 'QUAI',
        quoteMatch[3].trim(),
        lang,
      );
    }

    // ── Language ──
    const langMatch = trimmed.match(
      /^(?:language|lang)\s+(en|pcm|english|pidgin)$/i,
    );
    if (langMatch) {
      return this.handleLanguage(
        user._id.toString(),
        langMatch[1],
        from,
        lang,
      );
    }

    // ── History ──
    if (/^(history|transactions|activity)$/i.test(trimmed)) {
      return this.handleHistory(user._id.toString(), lang);
    }

    // ── Request money ──
    const requestMatch = trimmed.match(
      /^request\s+(\d+(?:[.,]\d+)?)\s*(?:([a-z]{3,5})\s+)?from\s+(.+)$/i,
    );
    if (requestMatch) {
      return this.handleRequest(
        user._id.toString(),
        requestMatch[1],
        requestMatch[2]?.toUpperCase() ?? 'QUAI',
        requestMatch[3].trim(),
        lang,
      );
    }

    // ── Send money ──
    const intent = this.parseTransferIntent(trimmed);
    if (intent) {
      this.sessions.set(from, {
        state: 'awaiting-pin',
        intent,
        createdAt: Date.now(),
      });
      return c.pinConfirm(
        intent.amount,
        intent.currency,
        intent.displayRecipient,
        intent.fee,
      );
    }

    return c.unknownCommand;
  }

  // ──────────────────────────────────────────────
  //  Registration (unregistered numbers)
  // ──────────────────────────────────────────────

  private async handleUnregistered(
    from: string,
    body: string,
    session: WhatsappSession | undefined,
  ): Promise<string> {
    const c = copy.en; // unregistered users have no lang preference yet

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
    return 'Welcome to Wype! To use this bot, you need to create an account first. Reply with your email address to get started.';
  }

  private async handleRegistrationEmail(
    from: string,
    body: string,
  ): Promise<string> {
    const c = copy.en;
    const email = body.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      return c.invalidEmail;
    }

    try {
      const result = await this.whatsappAuth.initiate(from, email);

      if (result.registered) {
        this.sessions.delete(from);
        return c.alreadyRegistered(email);
      }
    } catch (error) {
      this.logger.error(
        'WhatsApp registration initiation failed',
        error as Error,
      );
      return c.regError;
    }

    this.sessions.set(from, {
      state: 'awaiting-verification',
      email,
      createdAt: Date.now(),
    });
    return c.codeSent(email);
  }

  private async handleVerificationCode(
    from: string,
    body: string,
  ): Promise<string> {
    const c = copy.en;
    const result = await this.whatsappAuth.verify(from, body.trim());
    if (!result.ok) {
      return result.message;
    }

    this.sessions.delete(from);
    return c.registrationComplete(result.message);
  }

  // ──────────────────────────────────────────────
  //  Voice notes
  // ──────────────────────────────────────────────

  private async handleVoiceNote(
    from: string,
    userId: string,
    media: IncomingMedia,
    lang: 'en' | 'pcm',
  ): Promise<string> {
    const c = copy[lang];
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
      return lang === 'pcm'
        ? 'Sorry, I no fit understand your voice note. Abeg type your command like "Send 10 QUAI to john@email.com".'
        : 'Voice transcription is not available right now. Please type your command like "Send 10 QUAI to john@email.com".';
    }

    const intent = this.parseTransferIntent(text);
    if (!intent) {
      return c.voiceNoIntent;
    }

    this.sessions.set(from, {
      state: 'awaiting-pin',
      intent,
      createdAt: Date.now(),
    });

    return c.pinConfirm(
      intent.amount,
      intent.currency,
      intent.displayRecipient,
      intent.fee,
    );
  }

  // ──────────────────────────────────────────────
  //  Balance (with fiat estimate)
  // ──────────────────────────────────────────────

  private async handleBalance(
    userId: string,
    lang: 'en' | 'pcm',
  ): Promise<string> {
    const c = copy[lang];
    try {
      const wallet = await this.walletService.findByUserId(userId);
      if (!wallet) {
        return c.noWallet;
      }
      const balance = fromMinorUnits(wallet.balance);

      let fiat: string | undefined;
      try {
        const price = await this.blipService.getPrice();
        const usdPerQuai = Number(
          price.usd ?? price.priceUsd ?? price.usd_price ?? 0,
        );
        if (usdPerQuai > 0) {
          const usd = (Number(balance) * usdPerQuai).toFixed(2);
          fiat = `$${usd} USD`;
        }
      } catch {
        // Price fetch failed — just omit fiat
      }

      return c.balance(balance, wallet.currency, fiat);
    } catch (error) {
      this.logger.error('Balance lookup failed', error as Error);
      return 'Something went wrong while checking your balance. Please try again later.';
    }
  }

  // ──────────────────────────────────────────────
  //  Wallet creation
  // ──────────────────────────────────────────────

  private async handleCreateWallet(
    userId: string,
    lang: 'en' | 'pcm',
  ): Promise<string> {
    const c = copy[lang];
    try {
      const existing = await this.walletService.findByUserId(userId);
      if (existing) {
        return c.walletExists(existing.address);
      }

      const { address, encryptedPrivateKey } =
        this.blockchainService.generateWallet();
      await this.walletService.create(userId, address);
      await this.usersService.setWallet(userId, address, encryptedPrivateKey);

      return c.walletCreated(address);
    } catch (error) {
      this.logger.error('Wallet creation failed', error as Error);
      return 'Something went wrong while creating your wallet. Please try again later.';
    }
  }

  // ──────────────────────────────────────────────
  //  Fund wallet (Blip Pay link)
  // ──────────────────────────────────────────────

  private async handleFund(
    userId: string,
    amountStr: string | undefined,
    lang: 'en' | 'pcm',
  ): Promise<string> {
    const c = copy[lang];

    if (!amountStr) {
      return c.fundPrompt;
    }

    const amountCents = Math.round(Number(amountStr) * 100);
    if (!amountCents || amountCents <= 0) {
      return c.fundPrompt;
    }

    try {
      const result = await this.blipService.startFunding(userId, {
        amountCents,
      });
      return c.fundLink(amountStr, result.invoiceUrl);
    } catch (error) {
      this.logger.error('Fund initiation failed', error as Error);
      return c.fundError;
    }
  }

  // ──────────────────────────────────────────────
  //  Fee quote
  // ──────────────────────────────────────────────

  private async handleQuote(
    userId: string,
    amountStr: string,
    currency: string,
    recipient: string,
    lang: 'en' | 'pcm',
  ): Promise<string> {
    const c = copy[lang];

    if (!amountStr || !recipient) {
      return c.invalidQuote;
    }

    try {
      const fee = this.feesService.calculate(amountStr);
      const total = (Number(amountStr) + Number(fee))
        .toFixed(4)
        .replace(/0+$/, '')
        .replace(/\.$/, '');

      let mode = 'escrow';
      let expiry: string | undefined;
      if (recipient.includes('@')) {
        const recipientUser =
          await this.usersService.findByEmail(recipient);
        if (recipientUser) {
          mode = 'direct';
        } else {
          expiry = '7';
        }
      }

      return c.quote(amountStr, currency, fee, total, mode, expiry);
    } catch (error) {
      this.logger.error('Quote failed', error as Error);
      return 'Something went wrong while calculating the quote. Please try again.';
    }
  }

  // ──────────────────────────────────────────────
  //  Language toggle
  // ──────────────────────────────────────────────

  private async handleLanguage(
    userId: string,
    rawLang: string,
    from: string,
    currentLang: 'en' | 'pcm',
  ): Promise<string> {
    const normalized =
      rawLang.toLowerCase() === 'pcm' || rawLang.toLowerCase() === 'pidgin'
        ? 'pcm'
        : 'en';

    try {
      await this.usersService.setLang(userId, normalized);
    } catch (error) {
      this.logger.error('Language update failed', error as Error);
      return copy[currentLang].langInvalid;
    }

    return copy[normalized].langSet(normalized);
  }

  // ──────────────────────────────────────────────
  //  PIN handling
  // ──────────────────────────────────────────────

  private buildConfirmation(
    intent: SendIntent,
    lang: 'en' | 'pcm',
  ): string {
    const c = copy[lang];
    return c.pinConfirm(
      intent.amount,
      intent.currency,
      intent.displayRecipient,
      intent.fee,
    );
  }

  private async handlePin(
    from: string,
    userId: string,
    session: Extract<WhatsappSession, { state: 'awaiting-pin' }>,
    body: string,
    lang: 'en' | 'pcm',
  ): Promise<string> {
    const c = copy[lang];
    const pin = body.trim();
    if (!/^\d{4}$/.test(pin)) {
      return c.invalidPin;
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
        ? c.sendEscrowed(intent.amount, intent.currency, intent.displayRecipient)
        : c.sendSuccess(intent.amount, intent.currency, intent.displayRecipient);
    } catch (error) {
      return this.toFriendlyError(error, lang);
    }
  }

  private async handleNewPin(
    from: string,
    userId: string,
    session: WhatsappSession,
    body: string,
    lang: 'en' | 'pcm',
  ): Promise<string> {
    const c = copy[lang];
    const pin = body.trim();
    if (!/^\d{4}$/.test(pin)) {
      return c.pinNewInvalid;
    }

    this.sessions.delete(from);
    return this.applyPin(userId, pin, lang);
  }

  private async setPinDirect(
    from: string,
    userId: string,
    pin: string,
    lang: 'en' | 'pcm',
  ): Promise<string> {
    const c = copy[lang];
    if (!/^\d{4}$/.test(pin)) {
      return c.pinInvalidDirect;
    }

    return this.applyPin(userId, pin, lang);
  }

  private async applyPin(
    userId: string,
    pin: string,
    lang: 'en' | 'pcm',
  ): Promise<string> {
    const c = copy[lang];
    try {
      await this.usersService.setTransactionPin(userId, pin);
      return c.pinSet;
    } catch (error) {
      this.logger.error('Failed to set PIN via WhatsApp', error as Error);
      return c.pinError;
    }
  }

  private parseSetPinIntent(body: string): { pin?: string } | null {
    const match = body
      .trim()
      .match(/^(?:set|setup|change)\s+pin(?:\s+(\d+))?$/i);
    if (!match) return null;
    return { pin: match[1] };
  }

  // ──────────────────────────────────────────────
  //  Transfer intent parsing
  // ──────────────────────────────────────────────

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

  // ──────────────────────────────────────────────
  //  History
  // ──────────────────────────────────────────────

  private async handleHistory(
    userId: string,
    lang: 'en' | 'pcm',
  ): Promise<string> {
    const c = copy[lang];
    try {
      const transfers = await this.transferService.getHistory(userId);
      if (transfers.length === 0) return c.historyEmpty;

      const lines = transfers.slice(0, 5).map((t) => {
        const direction = t.sender?.toString() === userId ? 'out' : 'in';
        const email =
          direction === 'out'
            ? (t.recipientEmail ?? 'unknown')
            : 'sender';
        const amount = fromMinorUnits(t.amount);
        const status = String(t.status ?? 'pending');
        return c.historyItem(direction, email, amount, t.currency ?? 'QUAI', status);
      });

      return [c.historyHeader(lines.length), '', ...lines].join('\n');
    } catch {
      return lang === 'pcm'
        ? 'E no fit load your history. Try again later.'
        : 'Could not load your transaction history. Please try again later.';
    }
  }

  // ──────────────────────────────────────────────
  //  Request money
  // ──────────────────────────────────────────────

  private async handleRequest(
    userId: string,
    amount: string,
    currency: string,
    recipient: string,
    lang: 'en' | 'pcm',
  ): Promise<string> {
    const c = copy[lang];
    if (!EMAIL_PATTERN.test(recipient)) {
      return c.requestNoRecipient;
    }

    try {
      await this.requestService.create(userId, {
        recipientEmail: recipient.toLowerCase().trim(),
        amount,
        currency,
      });
      return c.requestCreated(amount, currency, recipient);
    } catch {
      return c.requestError;
    }
  }

  // ──────────────────────────────────────────────
  //  Help message
  // ──────────────────────────────────────────────

  private buildHelpMessage(lang: 'en' | 'pcm'): string {
    if (lang === 'pcm') {
      return [
        '👋 Welcome to Wype! Na wetin I fit do:',
        '',
        '💸 Send money',
        '   Send 10 QUAI to john@gmail.com',
        '   (email, phone number, or username like basil.quai)',
        '',
        '🎤 Send money by voice',
        '   Record voice note: "send 10 QUAI to basil.quai"',
        '',
        '💰 Check your balance',
        '   Reply "balance"',
        '',
        '🔑 Create wallet',
        '   Reply "wallet"',
        '',
        '💵 Fund wallet',
        '   Reply "fund 10" to add $10',
        '',
        '📊 Get fee quote',
        '   Reply "quote 10 to john@email.com"',
        '',
        '📋 View recent transactions',
        '   Reply "history"',
        '',
        '📩 Request money',
        '   Reply "request 10 from john@email.com"',
        '',
        '🔒 Set or change PIN',
        '   set pin 1234',
        '',
        '🌐 Change language',
        '   Reply "language en" or "language pcm"',
        '',
        'Reply with any command make you start.',
      ].join('\n');
    }

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
      '🔑 Create wallet',
      '   Reply "wallet"',
      '',
      '💵 Fund wallet',
      '   Reply "fund 10" to add $10 worth of QUAI',
      '',
      '📊 Get fee quote',
      '   Reply "quote 10 to john@email.com"',
      '',
      '📋 View recent transactions',
      '   Reply "history"',
      '',
      '📩 Request money',
      '   Reply "request 10 from john@email.com"',
      '',
      '🔒 Set or change your Transaction PIN',
      '   set pin 1234',
      '',
      '🌐 Change language',
      '   Reply "language en" or "language pcm"',
      '',
      'Reply with any command above to get started.',
    ].join('\n');
  }

  // ──────────────────────────────────────────────
  //  Error helpers
  // ──────────────────────────────────────────────

  private toFriendlyError(error: unknown, lang: 'en' | 'pcm'): string {
    const c = copy[lang];
    if (error instanceof UnauthorizedException) {
      return lang === 'pcm'
        ? 'PIN no correct. Try again.'
        : 'Invalid Transaction PIN. Please start again and try once more.';
    }
    if (error instanceof BadRequestException) {
      return `Sorry, the payment was not completed: ${error.message}`;
    }
    if (error instanceof NotFoundException) {
      return 'The payment could not be completed: recipient not found.';
    }
    this.logger.error('WhatsApp transfer failed', error as Error);
    return c.sendError;
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
