import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Transfer, TransferSchema } from '../transfer/schemas/transfer.schema';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { EscrowController } from './escrow.controller';
import { EscrowService } from './escrow.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transfer.name, schema: TransferSchema },
    ]),
    UsersModule,
    WalletModule,
  ],
  controllers: [EscrowController],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
