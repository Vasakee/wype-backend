import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClaimEscrowDto } from './dto/claim-escrow.dto';
import { CreateEmailTransferDto } from './dto/create-email-transfer.dto';
import { CreateWhatsappTransferDto } from './dto/create-whatsapp-transfer.dto';
import { TransferService } from './transfer.service';

@ApiTags('transfer')
@ApiBearerAuth()
@Controller('transfer')
@UseGuards(JwtAuthGuard)
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @ApiOperation({
    summary: 'Send QUAI by email',
    description:
      'Direct transfer if the recipient email belongs to a registered user; otherwise the funds are deposited into escrow for 7 days.',
  })
  @Post('email')
  @HttpCode(HttpStatus.CREATED)
  sendByEmail(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateEmailTransferDto,
  ) {
    return this.transferService.sendByEmail(req.user.sub, dto);
  }

  @ApiOperation({
    summary: 'Send QUAI by WhatsApp number (used internally by the bot)',
  })
  @Post('whatsapp')
  @HttpCode(HttpStatus.CREATED)
  sendByWhatsapp(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateWhatsappTransferDto,
  ) {
    return this.transferService.sendByWhatsapp(req.user.sub, dto);
  }

  @ApiOperation({ summary: 'List the last 50 transfers (sent & received)' })
  @Get('history')
  history(@Req() req: AuthenticatedRequest) {
    return this.transferService.getHistory(req.user.sub);
  }

  @ApiOperation({
    summary: 'Claim escrowed funds sent to your email/WhatsApp',
  })
  @Post('claim-escrow')
  @HttpCode(HttpStatus.OK)
  claimEscrow(@Req() req: AuthenticatedRequest, @Body() dto: ClaimEscrowDto) {
    return this.transferService.claimEscrow(req.user.sub, dto.pin);
  }
}
