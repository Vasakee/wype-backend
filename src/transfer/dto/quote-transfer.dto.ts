import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

export class QuoteTransferDto {
  @ApiPropertyOptional({
    description: 'Recipient email address (use this OR recipientUsername)',
    example: 'sam@example.com',
  })
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @ApiPropertyOptional({
    description: 'Recipient Wype username (use this OR recipientEmail)',
    example: 'basil.quai',
  })
  @IsOptional()
  @IsString()
  recipientUsername?: string;

  @ApiProperty({
    description: 'Amount in QUAI (major units)',
    example: '25',
  })
  @Matches(/^\d+(\.\d+)?$/, {
    message: 'amount must be a positive number',
  })
  amount: string;
}
