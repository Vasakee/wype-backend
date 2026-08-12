import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WalletService } from './wallet.service';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  getWallet(@Req() req: AuthenticatedRequest) {
    return this.walletService.findByUserId(req.user.sub);
  }

  @Post()
  createWallet(@Req() req: AuthenticatedRequest, @Body() dto: CreateWalletDto) {
    return this.walletService.create(req.user.sub, dto.address);
  }
}
