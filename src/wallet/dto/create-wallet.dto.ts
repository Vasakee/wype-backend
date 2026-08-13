import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateWalletDto {
  @ApiProperty({
    description:
      'Quai wallet address to link (also registers the email in the Registry)',
    example: '0x1234...abcd',
  })
  @IsString()
  @IsNotEmpty()
  address: string;
}
