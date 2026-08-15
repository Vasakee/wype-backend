import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreateSelfCustodyMovementDto {
  @ApiProperty({
    description: 'Amount in QUAI (major units)',
    example: '12.5',
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
