import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import {
  PushSubscription,
  PushSubscriptionSchema,
} from './push.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PushSubscription.name, schema: PushSubscriptionSchema },
    ]),
  ],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
