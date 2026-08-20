import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'EmailOrUsername', async: false })
export class EmailOrUsernameConstraint implements ValidatorConstraintInterface {
  validate(value: string, args: ValidationArguments): boolean {
    const obj = args.object as Record<string, unknown>;
    const hasEmail = Boolean(obj.recipientEmail);
    const hasUsername = Boolean(obj.recipientUsername);
    // At least one must be present; the field itself must be non-empty
    if (!value) return false;
    if (hasEmail && hasUsername) return false; // can't have both
    return true;
  }

  defaultMessage(): string {
    return 'Provide either recipientEmail or recipientUsername, not both';
  }
}

export class CreateEmailTransferDto {
  @ApiPropertyOptional({
    description: 'Recipient email address (use this OR recipientUsername)',
    example: 'sam@example.com',
  })
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @ApiPropertyOptional({
    description: 'Recipient Wype username (use this OR recipientEmail)',
    example: 'basil.quai',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9._@-]{1,30}$/, {
    message:
      'username must be 3-31 lowercase chars using letters, digits, dots, hyphens, underscores or @',
  })
  recipientUsername?: string;

  @ApiProperty({
    description: 'Amount in QUAI (major units)',
    example: '25',
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

  @ApiProperty({
    description:
      'Payment request id this transfer settles (internal bookkeeping)',
    example: '507f1f77bcf86cd799439011',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  requestId?: string;
}
