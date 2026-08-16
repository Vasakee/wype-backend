import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateRequestDto {
  @ApiProperty({
    description: 'Email of the person you are requesting money from',
    example: 'sam@example.com',
  })
  @IsEmail()
  recipientEmail: string;

  @ApiProperty({
    description: 'Amount in QUAI (major units)',
    example: '10',
  })
  @Matches(/^\d+(\.\d+)?$/, {
    message: 'amount must be a positive number',
  })
  amount: string;

  @ApiProperty({
    description: 'Optional note shown with the request',
    example: 'Splitting the dinner bill',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  note?: string;

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
