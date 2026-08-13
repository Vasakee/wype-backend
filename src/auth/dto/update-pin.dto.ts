import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class UpdatePinDto {
  @ApiProperty({
    description: 'New 4-digit Transaction PIN',
    example: '4829',
  })
  @Matches(/^\d{4}$/, {
    message: 'pin must be a 4-digit number',
  })
  pin: string;
}
