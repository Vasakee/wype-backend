import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'whatsappNumber must be in E.164 format, e.g. +14155552671',
  })
  whatsappNumber?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
