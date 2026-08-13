import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Email or phone number (E.164)',
    example: 'ada@example.com',
  })
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @ApiProperty({ description: 'Account password', example: 'password123' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
