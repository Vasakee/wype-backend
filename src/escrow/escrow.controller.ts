import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EscrowService } from './escrow.service';

@ApiTags('escrow')
@ApiBearerAuth()
@Controller('escrow')
@UseGuards(JwtAuthGuard)
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @ApiOperation({
    summary:
      'Reverse expired escrow transfers back to their senders (call from a cron/ops job)',
  })
  @Post('reverse-expired')
  @HttpCode(HttpStatus.OK)
  async reverseExpired() {
    const reversed = await this.escrowService.reverseExpiredEscrows();
    return { reversed };
  }
}
