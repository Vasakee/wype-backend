import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FeesService } from './fees.service';
import { Transfer, TransferSchema } from '../transfer/schemas/transfer.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transfer.name, schema: TransferSchema },
    ]),
  ],
  providers: [FeesService],
  exports: [FeesService],
})
export class FeesModule {}
