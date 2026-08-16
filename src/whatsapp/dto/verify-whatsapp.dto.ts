import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class VerifyWhatsappDto {
  @ApiProperty({
    description: 'Phone number being linked, E.164 format',
    example: '+14155552671',
  })
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'phone must be in E.164 format, e.g. +14155552671',
  })
  phone: string;

  @ApiProperty({
    description: '6-digit code sent to the number',
    example: '482913',
  })
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'code must be a 6-digit number',
  })
  code: string;
}
