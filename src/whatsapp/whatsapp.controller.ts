import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import twilio from 'twilio';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { WhatsappService } from './whatsapp.service';

@ApiTags('whatsapp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @ApiOperation({
    summary: 'Twilio inbound webhook (TwiML response)',
    description:
      'Point your Twilio WhatsApp Sandbox "when a message comes in" URL here. Unregistered numbers get WhatsApp onboarding (email + emailed code + PIN setup). Registered numbers support "Send 10 QUAI to <email|phone|username>" text commands, voice notes that say the same, and "set pin 1234".',
  })
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  async handleWebhook(@Body() incoming: IncomingMessageDto): Promise<string> {
    const from = (incoming.From ?? '').replace(/^whatsapp:/, '');
    const hasMedia = Number(incoming.NumMedia ?? 0) > 0;

    const reply = await this.whatsappService.processIncomingMessage(
      from,
      incoming.Body ?? '',
      {
        mediaUrl: hasMedia ? incoming.MediaUrl0 : undefined,
        mediaContentType: hasMedia ? incoming.MediaContentType0 : undefined,
      },
    );

    const response = new twilio.twiml.MessagingResponse();
    response.message(reply);
    return response.toString();
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send an outbound WhatsApp message via Twilio' })
  @Post('send')
  @UseGuards(JwtAuthGuard)
  send(@Body() dto: SendMessageDto) {
    return this.whatsappService.sendMessage(dto.to, dto.body);
  }
}
