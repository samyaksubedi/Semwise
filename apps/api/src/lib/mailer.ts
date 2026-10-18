import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * What the app sends mail through. Nodemailer over SMTP (Gmail now) is one implementation;
 * moving to a transactional provider later replaces only this file.
 */
export interface Mailer {
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

export function isMailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.MAIL_FROM);
}

class SmtpMailer implements Mailer {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURITY === "tls",
      requireTLS: env.SMTP_SECURITY === "starttls",
      ignoreTLS: env.SMTP_SECURITY === "none",
      ...(env.SMTP_USER && env.SMTP_PASSWORD
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
        : {}),
    });
  }

  async send(email: OutgoingEmail): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({ from: env.MAIL_FROM, ...email });
    return { messageId: String(info.messageId) };
  }
}

let mailer: Mailer | null = null;

export function getMailer(): Mailer {
  mailer ??= new SmtpMailer();
  return mailer;
}

/** Tests replace the mailer with a fake; real email is never sent from tests. */
export function setMailer(replacement: Mailer | null): void {
  mailer = replacement;
}
