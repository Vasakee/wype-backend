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
import { BlipService } from './blip.service';
import { FundWithBlipDto } from './dto/fund-with-blip.dto';

@ApiTags('blip')
@ApiBearerAuth()
@Controller('blip')
@UseGuards(JwtAuthGuard)
export class BlipController {
  constructor(private readonly blipService: BlipService) {}

  @ApiOperation({
    summary:
      'Start funding the user wallet via Blip Pay (managed QUAI Stripe checkout)',
  })
  @Post('fund')
  @HttpCode(HttpStatus.OK)
  fund(@Req() req: AuthenticatedRequest, @Body() dto: FundWithBlipDto) {
    return this.blipService.startFunding(req.user.sub, dto);
  }

  @ApiOperation({
    summary:
      'Poll a Blip funding session; credits the custodial ledger once paid',
  })
  @Get('fund/:sessionId')
  fundingStatus(
    @Req() req: AuthenticatedRequest,
    @Param('sessionId') sessionId: string,
  ) {
    return this.blipService.completeFunding(req.user.sub, sessionId);
  }

  @ApiOperation({ summary: 'Current QUAI price from Blip Pay' })
  @Get('price')
  getPrice() {
    return this.blipService.getPrice();
  }
}
