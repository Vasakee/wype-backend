import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateWhatsappTransferDto {
  @ApiProperty({
    description: 'Recipient email address (either this or recipientWhatsapp)',
    example: 'sam@example.com',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @ApiProperty({
    description:
      'Recipient WhatsApp number in E.164 (either this, recipientEmail or recipientUsername)',
    example: '+15555550100',
    required: false,
  })
  @IsOptional()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'recipientWhatsapp must be in E.164 format, e.g. +14155552671',
  })
  recipientWhatsapp?: string;

  @ApiProperty({
    description:
      'Recipient Wype username, e.g. basil.quai (either this, recipientEmail or recipientWhatsapp)',
    example: 'basil.quai',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  recipientUsername?: string;

  @ApiProperty({
    description: 'Amount in QUAI (major units)',
    example: '25',
  })
  @Matches(/^\d+(\.\d+)?$/, {
    message: 'amount must be a positive number',
  })
  amount: string;

  @ApiProperty({
    description: 'Sender 4-digit Transaction PIN',
    example: '4829',
  })
  @Matches(/^\d{4}$/, {
    message: 'pin must be a 4-digit number',
  })
  pin: string;

  @ApiProperty({
    description: 'Currency code (defaults to QUAI)',
    example: 'QUAI',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currency?: string;
}
