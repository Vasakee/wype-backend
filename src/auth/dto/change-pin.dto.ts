import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class ChangePinDto {
  @ApiProperty({
    description: 'Current 4-digit Transaction PIN',
    example: '4829',
  })
  @Matches(/^\d{4}$/, {
    message: 'currentPin must be a 4-digit number',
  })
  currentPin: string;

  @ApiProperty({
    description: 'New 4-digit Transaction PIN',
    example: '7311',
  })
  @Matches(/^\d{4}$/, {
    message: 'newPin must be a 4-digit number',
  })
  newPin: string;
}
