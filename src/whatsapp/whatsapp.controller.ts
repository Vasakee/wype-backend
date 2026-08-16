import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import twilio from 'twilio';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { LinkWhatsappDto } from './dto/link-whatsapp.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { VerifyWhatsappDto } from './dto/verify-whatsapp.dto';
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

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Link a WhatsApp number — sends a 6-digit code to that number',
  })
  @Post('link')
  @UseGuards(JwtAuthGuard)
  link(@Req() req: AuthenticatedRequest, @Body() dto: LinkWhatsappDto) {
    return this.whatsappService.linkStart(req.user.sub, dto.phone);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify the code to finish linking the number' })
  @Post('verify')
  @UseGuards(JwtAuthGuard)
  verify(@Req() req: AuthenticatedRequest, @Body() dto: VerifyWhatsappDto) {
    return this.whatsappService.linkVerify(req.user.sub, dto.phone, dto.code);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unlink the WhatsApp number from the account' })
  @Delete('link')
  @UseGuards(JwtAuthGuard)
  unlink(@Req() req: AuthenticatedRequest) {
    return this.whatsappService.unlink(req.user.sub);
  }
}
