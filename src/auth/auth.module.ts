import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JwtModule,
  type JwtModuleOptions,
  type JwtSignOptions,
} from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { EscrowModule } from '../escrow/escrow.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { MagicLinkService } from './magic-link.service';
import {
  MagicLinkToken,
  MagicLinkTokenSchema,
} from './schemas/magic-link-token.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MagicLinkToken.name, schema: MagicLinkTokenSchema },
    ]),
    UsersModule,
    WalletModule,
    EscrowModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ??
            '7d') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, MagicLinkService],
  exports: [AuthService],
})
export class AuthModule {}
