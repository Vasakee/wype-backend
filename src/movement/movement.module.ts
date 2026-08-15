import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { MovementController } from './movement.controller';
import { Movement, MovementSchema } from './movement.schema';
import { MovementService } from './movement.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Movement.name, schema: MovementSchema },
    ]),
    UsersModule,
    WalletModule,
  ],
  controllers: [MovementController],
  providers: [MovementService],
  exports: [MovementService],
})
export class MovementModule {}
