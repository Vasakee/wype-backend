import { Global, Module, forwardRef } from '@nestjs/common';
import { TransferModule } from '../transfer/transfer.module';
import { UsersModule } from '../users/users.module';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Global()
@Module({
  imports: [forwardRef(() => TransferModule), UsersModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
