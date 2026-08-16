import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BlipModule } from './blip/blip.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { EmailModule } from './email/email.module';
import { EscrowModule } from './escrow/escrow.module';
import { FeesModule } from './fees/fees.module';
import { MovementModule } from './movement/movement.module';
import { RequestModule } from './request/request.module';
import { TransferModule } from './transfer/transfer.module';
import { UsersModule } from './users/users.module';
import { VoiceModule } from './voice/voice.module';
import { WalletModule } from './wallet/wallet.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    UsersModule,
    AuthModule,
    WalletModule,
    TransferModule,
    WhatsappModule,
    BlockchainModule,
    EmailModule,
    EscrowModule,
    VoiceModule,
    FeesModule,
    MovementModule,
    BlipModule,
    RequestModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
