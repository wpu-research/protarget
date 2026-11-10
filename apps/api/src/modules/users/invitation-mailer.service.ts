import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { RuntimeConfig } from '../../common/runtime-config';

@Injectable()
export class InvitationMailer {
  private readonly transport;
  constructor(private readonly config: RuntimeConfig) {
    const values = config.values;
    this.transport = createTransport({
      host: values.smtpHost, port: values.smtpPort, secure: values.smtpPort === 465,
      requireTLS: values.nodeEnv === 'production' && values.smtpPort !== 465,
      ...(values.smtpUser ? { auth: { user: values.smtpUser, pass: values.smtpPassword } } : {}),
      logger: false, debug: false, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      disableFileAccess: true, disableUrlAccess: true,
    });
  }

  async send(email: string, rawToken: string): Promise<boolean> {
    // Fragment keeps the token out of web-server request and Referer logs.
    const url = `${this.config.values.webOrigin}/accept-invite#token=${encodeURIComponent(rawToken)}`;
    try {
      const result = await this.transport.sendMail({
        from: this.config.values.smtpFrom, to: email, subject: 'Your Protarget invitation',
        text: `Set your Protarget password using this single-use link (valid for 24 hours):\n${url}\n`,
      });
      return result.accepted.length > 0;
    } catch {
      // No raw SMTP exceptions: messages can contain AUTH, addresses and the invitation URL.
      return false;
    }
  }
}
