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

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  handleWebhook(@Body() incoming: IncomingMessageDto): string {
    const response = new twilio.twiml.MessagingResponse();
    response.message(
      incoming.Body
        ? `Wype received "${incoming.Body}". Our team will respond shortly.`
        : 'Thanks for messaging Wype. Our team will respond shortly.',
    );
    return response.toString();
  }

  @Post('send')
  @UseGuards(JwtAuthGuard)
  send(@Body() dto: SendMessageDto) {
    return this.whatsappService.sendMessage(dto.to, dto.body);
  }
}
