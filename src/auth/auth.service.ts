import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { BlockchainService } from '../blockchain/blockchain.service';
import type { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { MagicLinkService } from './magic-link.service';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly magicLinkService: MagicLinkService,
    private readonly blockchainService: BlockchainService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();

    const existing = await this.usersService.findByEmail(email);
    if (existing?.isEmailVerified) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, BCRYPT_ROUNDS)
      : undefined;

    const { token, link } = this.magicLinkService.issue({
      email,
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber,
      passwordHash,
    });

    this.magicLinkService.sendMagicLink(email, link);

    return {
      message:
        'Magic link sent to your email. Click it to verify your address and create your account.',
      ...(process.env.NODE_ENV === 'production'
        ? {}
        : { magicLink: link, token }),
    };
  }

  async verifyMagicLink(token: string) {
    const pending = this.magicLinkService.consume(token);
    if (!pending) {
      throw new BadRequestException('Magic link is invalid or has expired');
    }

    const existing = await this.usersService.findByEmail(pending.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const { address, encryptedPrivateKey } =
      this.blockchainService.generateWallet();

    const user = await this.usersService.create({
      email: pending.email,
      fullName: pending.fullName,
      phoneNumber: pending.phoneNumber,
      passwordHash: pending.passwordHash,
      isEmailVerified: true,
      walletAddress: address,
      encryptedPrivateKey,
    });

    await this.walletService
      .create(user._id.toString(), address)
      .catch((error: unknown) => {
        this.logger.error('Failed to create wallet ledger', error as Error);
        throw error;
      });

    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByIdentityWithPassword(
      dto.identifier,
    );

    if (
      !user?.passwordHash ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException('Please verify your email first');
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
      phoneNumber: user.phoneNumber,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: {
        id: user._id.toString(),
        email: user.email,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        walletAddress: user.walletAddress,
        isEmailVerified: user.isEmailVerified,
        hasTransactionPin: user.isPinSet,
      },
    };
  }
}
