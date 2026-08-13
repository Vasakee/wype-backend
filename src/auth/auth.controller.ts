import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdatePinDto } from './dto/update-pin.dto';
import type { AuthenticatedRequest } from './interfaces/authenticated-request.interface';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Register a new account (email and/or WhatsApp)' })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @ApiOperation({ summary: 'Login with email or WhatsApp number + password' })
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
}
