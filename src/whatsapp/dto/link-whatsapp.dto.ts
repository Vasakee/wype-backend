import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class LinkWhatsappDto {
  @ApiProperty({
    description: 'Phone number to link, E.164 format',
    example: '+14155552671',
  })
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'phone must be in E.164 format, e.g. +14155552671',
  })
  phone: string;
}
