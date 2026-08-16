import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class AcceptRequestDto {
  @ApiProperty({
    description: '4-digit Transaction PIN of the person paying the request',
    example: '4829',
  })
  @Matches(/^\d{4}$/, {
    message: 'pin must be a 4-digit number',
  })
  pin: string;
}
