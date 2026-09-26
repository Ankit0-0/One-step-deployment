import type { Logger } from 'pino';
import { Resend } from 'resend';

export interface EmailSender {
  sendLoginCode(email: string, code: string): Promise<void>;
}

/** EMAIL_DRIVER=console: log the code instead of sending it (local dev and tests). */
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly logger: Logger) {}

  sendLoginCode(email: string, code: string): Promise<void> {
    this.logger.info({ email }, `Login code for ${email}: ${code}`);
    return Promise.resolve();
  }
}

export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async sendLoginCode(email: string, code: string): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: email,
      subject: `Your login code: ${code}`,
      text: `Your login code is ${code}. It expires in 10 minutes.\n\nIf you didn't request it, ignore this email.`,
    });
    if (error) throw new Error(`Resend failed: ${error.name}`);
  }
}
