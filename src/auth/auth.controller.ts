import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdatePinDto } from './dto/update-pin.dto';
import { ChangePinDto } from './dto/change-pin.dto';
import type { AuthenticatedRequest } from './interfaces/authenticated-request.interface';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({
    summary:
      'Start registration with an email — sends a magic link to verify it',
  })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @ApiOperation({
    summary:
      'Verify the magic link — creates the account, generates a wallet, and returns a JWT',
  })
  @Get('verify-magic-link')
  verifyMagicLink(@Query('token') token: string) {
    return this.authService.verifyMagicLink(token);
  }

  @ApiOperation({
    summary: 'Login with email or phone number + password (fallback)',
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set or update the 4-digit Transaction PIN' })
  @Post('pin')
  @UseGuards(JwtAuthGuard)
  setPin(@Req() req: AuthenticatedRequest, @Body() dto: UpdatePinDto) {
    return this.authService.setPin(req.user.sub, dto.pin);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change the 4-digit Transaction PIN (requires the current PIN)',
  })
  @Put('pin')
  @UseGuards(JwtAuthGuard)
  changePin(@Req() req: AuthenticatedRequest, @Body() dto: ChangePinDto) {
    return this.authService.changePin(req.user.sub, dto.currentPin, dto.newPin);
  }
}
