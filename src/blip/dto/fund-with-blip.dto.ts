import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsInt, IsOptional, Min } from 'class-validator';

export class FundWithBlipDto {
  @ApiProperty({
    description: 'Amount to fund in USD cents',
    example: 2500,
  })
  @IsInt()
  @Min(1)
  amountCents: number;

  @ApiProperty({
    description: 'Email to attach to the Stripe checkout',
    example: 'user@example.com',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;
}
