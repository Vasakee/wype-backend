import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Movement, MovementSchema } from '../movement/movement.schema';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { BlipController } from './blip.controller';
import { BlipService } from './blip.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Movement.name, schema: MovementSchema },
    ]),
    UsersModule,
    WalletModule,
  ],
  controllers: [BlipController],
  providers: [BlipService],
  exports: [BlipService],
})
export class BlipModule {}
