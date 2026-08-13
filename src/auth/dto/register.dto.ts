import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    description: 'Email address (only this is required to register)',
    example: 'ada@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Full name',
    example: 'Ada Lovelace',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName?: string;

  @ApiProperty({
    description: 'Phone number in E.164 format',
    example: '+14155552671',
    required: false,
  })
  @IsOptional()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'phoneNumber must be in E.164 format, e.g. +14155552671',
  })
  phoneNumber?: string;

  @ApiProperty({
    description:
      'Optional password (min 8 characters). Used only for password login fallback — not required for magic-link registration.',
    example: 'password123',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}
