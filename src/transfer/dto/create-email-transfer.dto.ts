import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateEmailTransferDto {
  @ApiProperty({
    description: 'Recipient email address',
    example: 'sam@example.com',
  })
  @IsEmail()
  recipientEmail: string;

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
