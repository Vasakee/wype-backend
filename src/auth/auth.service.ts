import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    if (!dto.email && !dto.whatsappNumber) {
      throw new BadRequestException(
        'Provide at least an email or a WhatsApp number',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const transactionPin = dto.transactionPin
      ? await bcrypt.hash(dto.transactionPin, BCRYPT_ROUNDS)
      : undefined;

    const user = await this.usersService
      .create({
        name: dto.name,
        email: dto.email,
        whatsappNumber: dto.whatsappNumber,
        passwordHash,
        transactionPin,
      })
      .catch((error: unknown) => {
        if ((error as { code?: number }).code === 11000) {
          throw new ConflictException(
            'A user with this email or WhatsApp number already exists',
          );
        }
        throw error;
      });

    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByIdentityWithPassword(
      dto.identifier,
    );

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthResponse(user);
  }

  async setPin(userId: string, pin: string) {
    await this.usersService.setTransactionPin(userId, pin);
    return { message: 'Transaction PIN updated' };
  }

  private async buildAuthResponse(user: UserDocument) {
    const payload: JwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      whatsappNumber: user.whatsappNumber,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        whatsappNumber: user.whatsappNumber,
        hasTransactionPin: Boolean(user.transactionPin),
      },
    };
  }
}
