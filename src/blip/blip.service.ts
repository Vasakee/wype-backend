import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import {
  Movement,
  MovementDocument,
  MovementStatus,
  MovementType,
} from '../movement/movement.schema';
import { toMinorUnits } from '../transfer/units';
import { buildBlipInvoiceLink } from '../utils/blip';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { FundWithBlipDto } from './dto/fund-with-blip.dto';

export interface ManagedQuaiCheckoutParams {
  address: string;
  amountCents: number;
  customerEmail?: string;
}

/**
 * Thin client over the Blip Pay API (https://blippay.me) plus the funding
 * orchestration Wype needs: managed QUAI checkout → invoice page → funding
 * status → convert-to-wallet → credit the custodial ledger.
 */
@Injectable()
export class BlipService {
  private readonly logger = new Logger(BlipService.name);
  private readonly baseUrl: string;

  constructor(
    @InjectModel(Movement.name)
    private readonly movementModel: Model<MovementDocument>,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    configService: ConfigService,
  ) {
    this.baseUrl = (
      configService.get<string>('BLIP_BASE_URL') ?? 'https://blippay.me'
    ).replace(/\/+$/, '');
  }

  async getPrice(): Promise<Record<string, unknown>> {
    return this.get('/api/price');
  }

  async startFunding(userId: string, dto: FundWithBlipDto) {
    const user = await this.usersService.findById(userId);
    if (!user?.walletAddress) {
      throw new BadRequestException(
        'Link a self-custody wallet before funding it',
      );
    }

    const checkout = await this.post('/api/ramp/managed-quai/checkout', {
      address: user.walletAddress,
      amount_cents: dto.amountCents,
      customer_email: dto.customerEmail,
    });

    const sessionId =
      this.extractString(checkout, ['session_id', 'sessionId']) ??
      `cs_${randomUUID()}`;
    const invoiceRef =
      this.extractString(checkout, ['invoice_ref', 'invoiceRef']) ??
      `inv_${randomUUID()}`;

    const blipLink = buildBlipInvoiceLink({
      invoiceRef,
      address: user.walletAddress,
    });

    const movement = await this.movementModel.create({
      userId: new Types.ObjectId(userId),
      amount: '0',
      currency: 'QUAI',
      blipLink,
      type: MovementType.Funding,
      status: MovementStatus.Pending,
      sessionId,
      invoiceRef,
      amountCents: dto.amountCents,
    });

    return {
      movementId: movement._id.toString(),
      sessionId,
      invoiceUrl: blipLink,
      statusUrl: `/api/blip/fund/${sessionId}`,
    };
  }

  async completeFunding(userId: string, sessionId: string) {
    const movement = await this.movementModel
      .findOne({
        sessionId,
        userId: new Types.ObjectId(userId),
        type: MovementType.Funding,
      })
      .exec();

    if (!movement) {
      throw new NotFoundException('Funding session not found');
    }
    if (movement.status === MovementStatus.Completed) {
      return {
        status: 'completed',
        alreadyProcessed: true,
        movementId: movement._id.toString(),
      };
    }

    const user = await this.usersService.findById(userId);
    if (!user?.walletAddress) {
      throw new BadRequestException(
        'Link a self-custody wallet before funding it',
      );
    }

    const funding = await this.getManagedQuaiFundingStatus({
      sessionId,
      address: user.walletAddress,
    });
    if (!this.isFunded(funding)) {
      return { status: 'pending' };
    }

    const conversion = await this.convertToWallet({
      invoiceRef: movement.invoiceRef as string,
      quaiAddress: user.walletAddress,
    });

    const amountMinor = await this.fiatToMinorUnits(movement.amountCents ?? 0);
    await this.walletService.credit(userId, amountMinor);

    movement.amount = amountMinor;
    movement.status = MovementStatus.Completed;
    movement.txHash = this.extractString(conversion, [
      'tx_hash',
      'txHash',
      'hash',
    ]);
    await movement.save();

    return {
      status: 'completed',
      movementId: movement._id.toString(),
      amountCredited: amountMinor,
      txHash: movement.txHash,
    };
  }

  async getManagedQuaiFundingStatus(params: {
    sessionId: string;
    address: string;
  }): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({
      session_id: params.sessionId,
      q: params.address,
    });
    return this.get(
      `/api/ramp/managed-quai/funding-status?${query.toString()}`,
    );
  }

  async convertToWallet(params: {
    invoiceRef: string;
    quaiAddress: string;
  }): Promise<Record<string, unknown>> {
    return this.post('/api/ramp/managed-quai/convert-to-wallet', {
      invoice_ref: params.invoiceRef,
      quai_address: params.quaiAddress,
    });
  }

  private async fiatToMinorUnits(amountCents: number): Promise<string> {
    const price = await this.getPrice();
    const usdPerQuai = Number(
      price.usd ?? price.priceUsd ?? price.usd_price ?? 0,
    );
    if (!usdPerQuai || usdPerQuai <= 0) {
      throw new BadRequestException(
        'Could not determine the QUAI price to credit your balance',
      );
    }
    const amountQuai = amountCents / 100 / usdPerQuai;
    return toMinorUnits(amountQuai.toFixed(8));
  }

  private isFunded(funding: Record<string, unknown>): boolean {
    return (
      funding.paid === true ||
      funding.funded === true ||
      funding.status === 'paid' ||
      funding.status === 'completed' ||
      funding.state === 'paid' ||
      funding.state === 'completed'
    );
  }

  private extractString(
    body: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = body[key];
      if (typeof value === 'string' && value) return value;
    }
    return undefined;
  }

  private get(path: string): Promise<Record<string, unknown>> {
    return this.request(path, { method: 'GET' });
  }

  private post(path: string, body: unknown): Promise<Record<string, unknown>> {
    return this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, init);
      if (!response.ok) {
        throw new Error(`Blip API responded with ${response.status}`);
      }
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      this.logger.error(`Blip API request failed: ${path}`, error as Error);
      throw new ServiceUnavailableException(
        'Blip Pay is currently unavailable',
      );
    }
  }
}
