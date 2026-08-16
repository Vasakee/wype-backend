import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BlockchainService } from '../blockchain/blockchain.service';
import { toMinorUnits } from '../transfer/units';
import { buildBlipInvoiceLink } from '../utils/blip';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { CreateSelfCustodyMovementDto } from './dto/create-self-custody-movement.dto';
import {
  Movement,
  MovementDocument,
  MovementStatus,
  MovementType,
} from './movement.schema';

/**
 * Moves funds from the custodial ledger into the user's own self-custody
 * wallet, handing back a Blip Pay funding invoice link to see/complete the move
 * non-custodially.
 */
@Injectable()
export class MovementService {
  constructor(
    @InjectModel(Movement.name)
    private readonly movementModel: Model<MovementDocument>,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly blockchainService: BlockchainService,
  ) {}

  async moveToSelfCustody(userId: string, dto: CreateSelfCustodyMovementDto) {
    const user = await this.usersService.verifyTransactionPin(userId, dto.pin);
    if (!user.walletAddress) {
      throw new NotFoundException(
        'No self-custody wallet exists for this account yet',
      );
    }

    const amount = toMinorUnits(dto.amount);
    if (BigInt(amount) <= 0n) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    const wallet = await this.walletService.findByUserId(userId);
    if (!wallet) {
      throw new NotFoundException('No wallet found for this user');
    }
    if (BigInt(wallet.balance) < BigInt(amount)) {
      throw new ConflictException('Insufficient wallet balance');
    }

    const receipt = await this.blockchainService.moveToSelfCustody(
      user.walletAddress,
      amount,
    );

    await this.walletService.debit(userId, amount);

    const movement = await this.movementModel.create({
      userId: new Types.ObjectId(userId),
      amount,
      currency: dto.currency ?? 'QUAI',
      type: MovementType.SelfCustody,
      status: MovementStatus.Completed,
      txHash: receipt.txHash,
    });

    const blipLink = buildBlipInvoiceLink({
      invoiceRef: movement._id.toString(),
      address: user.walletAddress,
    });

    movement.blipLink = blipLink;
    await movement.save();

    return {
      movementId: movement._id.toString(),
      amount: dto.amount,
      currency: dto.currency ?? 'QUAI',
      walletAddress: user.walletAddress,
      blipLink,
      txHash: receipt.txHash,
    };
  }

  findById(userId: string, movementId: string) {
    return this.movementModel
      .findOne({ _id: movementId, userId: new Types.ObjectId(userId) })
      .exec();
  }
}
