import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @ApiOperation({ summary: 'Get the current user wallet (null if not linked)' })
  @Get()
  getWallet(@Req() req: AuthenticatedRequest) {
    return this.walletService.findByUserId(req.user.sub);
  }

  @ApiOperation({
    summary: 'Link a Quai wallet (also registers the email in the Registry)',
  })
  @Post()
  createWallet(@Req() req: AuthenticatedRequest, @Body() dto: CreateWalletDto) {
    return this.walletService.create(req.user.sub, dto.address);
  }

  @ApiOperation({
    summary:
      'Check on-chain balance and credit any new deposits to the custodial ledger',
  })
  @Post('deposit/check')
  @HttpCode(HttpStatus.OK)
  checkDeposit(@Req() req: AuthenticatedRequest) {
    return this.walletService.checkDeposit(req.user.sub);
  }
}
