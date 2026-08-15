import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { USERNAME_PATTERN } from '../username';

export class ClaimUsernameDto {
  @ApiProperty({
    description:
      'Custom username to claim, e.g. "basil.quai" or "basil@wype". Lowercase letters, digits, dots, hyphens, underscores or @, 3-31 characters.',
    example: 'basil.quai',
  })
  @Matches(USERNAME_PATTERN, {
    message:
      'username must be 3-31 characters using lowercase letters, digits, dots, hyphens, underscores or @',
  })
  username: string;
}
