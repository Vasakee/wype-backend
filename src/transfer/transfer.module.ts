import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { Transfer, TransferSchema } from './schemas/transfer.schema';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transfer.name, schema: TransferSchema },
    ]),
    forwardRef(() => WhatsappModule),
    UsersModule,
    WalletModule,
  ],
  controllers: [TransferController],
  providers: [
    TransferService,
    { provide: 'WHATSAPP_SERVICE', useExisting: WhatsappService },
  ],
  exports: [TransferService],
})
export class TransferModule {}
