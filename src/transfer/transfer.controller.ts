import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClaimEscrowDto } from './dto/claim-escrow.dto';
import { CreateEmailTransferDto } from './dto/create-email-transfer.dto';
import { CreateWhatsappTransferDto } from './dto/create-whatsapp-transfer.dto';
import { QuoteTransferDto } from './dto/quote-transfer.dto';
import { TransferService } from './transfer.service';

@ApiTags('transfer')
@ApiBearerAuth()
@Controller('transfer')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @ApiOperation({
    summary: 'Send QUAI by email',
    description:
      'Direct transfer if the recipient email belongs to a registered user; otherwise the funds are deposited into escrow for 7 days.',
  })
  @Post('email')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  sendByWhatsapp(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateWhatsappTransferDto,
  ) {
    return this.transferService.sendByWhatsapp(req.user.sub, dto);
  }

  @ApiOperation({
    summary: 'Quote the fee and routing mode for an email transfer',
  })
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  quote(@Req() req: AuthenticatedRequest, @Body() dto: QuoteTransferDto) {
    return this.transferService.quote(req.user.sub, dto);
  }

  @ApiOperation({ summary: 'List the last 50 transfers (sent & received)' })
  @Get('history')
  @UseGuards(JwtAuthGuard)
  history(@Req() req: AuthenticatedRequest) {
    return this.transferService.getHistory(req.user.sub);
  }

  @ApiOperation({ summary: 'Get a single transfer (sender or recipient only)' })
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.transferService.findById(req.user.sub, id);
  }

  @ApiOperation({
    summary: 'Claim escrowed funds sent to your email/WhatsApp',
  })
  @Post('claim-escrow')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  claimEscrow(@Req() req: AuthenticatedRequest, @Body() dto: ClaimEscrowDto) {
    return this.transferService.claimEscrow(req.user.sub, dto.pin);
  }

  @ApiOperation({
    summary: 'Cancel an escrowed transfer and refund the sender',
  })
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ClaimEscrowDto,
  ) {
    return this.transferService.cancel(req.user.sub, id, dto.pin);
  }

  @ApiOperation({ summary: 'Resend the claim invite email for an escrow' })
  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  resend(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.transferService.resendInvite(req.user.sub, id);
  }

  @ApiOperation({ summary: 'Public claim-link status for /claim/[token]' })
  @Get('claim/:token')
  claimStatus(@Param('token') token: string) {
    return this.transferService.claimStatus(token);
  }

  @ApiOperation({
    summary: 'Public claim-start — emails a claim-bound magic link',
  })
  @Post('claim/:token/start')
  @HttpCode(HttpStatus.OK)
  startClaim(@Param('token') token: string) {
    return this.transferService.startClaim(token);
  }
}
