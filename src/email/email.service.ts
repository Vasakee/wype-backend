import { Injectable, Logger } from '@nestjs/common';

/**
 * Mock email delivery — logs the message so it is reachable in development.
 * Swap for an SMTP / Resend / SendGrid call once one is wired up.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  send(to: string, subject: string, body: string): void {
    this.logger.log(`[mock-email] To: ${to}\nSubject: ${subject}\n\n${body}`);
  }
}
