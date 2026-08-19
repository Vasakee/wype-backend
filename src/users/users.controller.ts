import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ClaimUsernameDto } from './dto/claim-username.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('user')
@UseGuards(JwtAuthGuard)
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly blockchainService: BlockchainService,
 ) {}

  @ApiOperation({ summary: 'Get the current user profile' })
  @Get('me')
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.usersService.findById(req.user.sub);
  }

  @ApiOperation({
    summary:
      'Check whether an email belongs to a registered Wype account (recipient resolution)',
  })
  @Get('lookup')
  async lookup(@Query('email') email?: string) {
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return { registered: false };
    }
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return { registered: false };
    }
    return {
      registered: true,
      displayName: user.fullName ?? user.email.split('@')[0],
      username: user.username,
    };
  }

  @ApiOperation({
    summary:
      'Claim a custom username (optional, does not affect email/phone identity)',
    description:
      'Sets a unique username on the user. Throws 409 if it is already taken.',
  })
  @Post('claim-username')
  @HttpCode(HttpStatus.OK)
  async claimUsername(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ClaimUsernameDto,
  ) {
    const user = await this.usersService.claimUsername(
      req.user.sub,
      dto.username,
    );

    // Register on-chain (best-effort — DB write is the source of truth)
    if (user.walletAddress) {
      try {
        await this.blockchainService.registerName(
          dto.username.toLowerCase().trim(),
          user.walletAddress,
        );
      } catch (error) {
        this.logger.warn(
          `On-chain registration failed for ${dto.username}: ${(error as Error).message}`,
        );
      }
    }

    return user;
  }
}
