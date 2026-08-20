import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly adminEmails: Set<string>;

  constructor(
    configService: ConfigService,
    private readonly reflector: Reflector,
  ) {
    const raw = configService.get<string>('ADMIN_EMAILS') ?? '';
    this.adminEmails = new Set(
      raw
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.email) {
      throw new ForbiddenException('Not authenticated');
    }
    if (!this.adminEmails.has(user.email.toLowerCase())) {
      throw new ForbiddenException('Not an admin');
    }
    return true;
  }
}
