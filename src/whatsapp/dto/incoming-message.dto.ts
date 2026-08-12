import { Allow } from 'class-validator';

export class IncomingMessageDto {
  @Allow()
  MessageSid?: string;

  @Allow()
  From?: string;

  @Allow()
  To?: string;

  @Allow()
  Body?: string;
}
