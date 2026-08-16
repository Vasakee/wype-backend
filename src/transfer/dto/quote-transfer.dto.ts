import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, Matches } from 'class-validator';

export class QuoteTransferDto {
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
}
