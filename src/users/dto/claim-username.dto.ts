import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { USERNAME_PATTERN } from '../username';

export class ClaimUsernameDto {
  @ApiProperty({
    description:
      'Custom username to claim, e.g. "basil.quai". Must end with .quai. Lowercase letters, digits, dots, hyphens, underscores, 3-31 characters.',
    example: 'basil.quai',
  })
  @Matches(USERNAME_PATTERN, {
    message:
      'username must end with .quai and contain only lowercase letters, digits, dots, hyphens, or underscores (3-31 characters)',
  })
  username: string;
}
