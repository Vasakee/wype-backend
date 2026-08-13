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
  @ApiProperty({ description: 'Display name', example: 'Ada Lovelace' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Email address (optional if WhatsApp number is provided)',
    example: 'ada@example.com',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    description:
      'WhatsApp number in E.164 format (optional if email is provided)',
    example: '+14155552671',
    required: false,
  })
  @IsOptional()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'whatsappNumber must be in E.164 format, e.g. +14155552671',
  })
  whatsappNumber?: string;

  @ApiProperty({
    description: 'Optional 4-digit Transaction PIN',
    example: '4829',
    required: false,
  })
  @IsOptional()
  @Matches(/^\d{4}$/, {
    message: 'transactionPin must be a 4-digit number',
  })
  transactionPin?: string;

  @ApiProperty({
    description: 'Account password (min 8 characters)',
    example: 'password123',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
