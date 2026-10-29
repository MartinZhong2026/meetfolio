import nodemailer from 'nodemailer';
import type { Logger } from '../lib/logger.js';

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<{ delivered: boolean }>;
}

export function createMailer(opts: { smtpUrl?: string; from: string; logger: Logger; isProd: boolean }): Mailer {
  if (!opts.smtpUrl) {
    return {
      async send(to, subject, text) {
        // Never log message bodies in production: they contain single-use reset links.
        if (opts.isProd) opts.logger.warn({ subject }, 'SMTP_URL is not configured; email was not delivered');
        else opts.logger.info({ to, subject, body: text }, 'dev mailer (SMTP_URL not set) — email not sent, printing instead');
        return { delivered: false };
      },
    };
  }
  const transport = nodemailer.createTransport(opts.smtpUrl);
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: opts.from, to, subject, text });
      return { delivered: true };
    },
  };
}
