import { Global, Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlipModule } from '../blip/blip.module';
import { FeesModule } from '../fees/fees.module';
import { TransferModule } from '../transfer/transfer.module';
import { UsersModule } from '../users/users.module';
import { VoiceModule } from '../voice/voice.module';
import { WalletModule } from '../wallet/wallet.module';
import { WhatsappAuthService } from './whatsapp-auth.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Global()
@Module({
  imports: [
    forwardRef(() => TransferModule),
    UsersModule,
    VoiceModule,
    FeesModule,
    WalletModule,
    AuthModule,
    BlipModule,
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService, WhatsappAuthService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
