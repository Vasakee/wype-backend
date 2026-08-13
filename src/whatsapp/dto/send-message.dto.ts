import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({
    description: 'Recipient phone number (E.164, whatsapp: prefix optional)',
    example: '+15555550100',
  })
  @IsString()
  @IsNotEmpty()
  to: string;

  @ApiProperty({
    description: 'Message body',
    example: 'You received 25 QUAI via Wype.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1600)
  body: string;
}
