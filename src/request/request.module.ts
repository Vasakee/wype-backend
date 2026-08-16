import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TransferModule } from '../transfer/transfer.module';
import { UsersModule } from '../users/users.module';
import { RequestController } from './request.controller';
import { Request, RequestSchema } from './request.schema';
import { RequestService } from './request.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Request.name, schema: RequestSchema }]),
    UsersModule,
    TransferModule,
  ],
  controllers: [RequestController],
  providers: [RequestService],
  exports: [RequestService],
})
export class RequestModule {}
