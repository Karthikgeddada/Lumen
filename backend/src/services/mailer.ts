import nodemailer from 'nodemailer';
import { config } from '../config';
import { logger } from '../logger';

// Any SMTP provider works (Resend, Postmark, SES SMTP, …). When MAIL_DEV_MODE
// is on, messages are logged instead of sent — never enable it in production.

const transport = config.mail.host
  ? nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined,
    })
  : null;

async function send(to: string, subject: string, html: string, text: string) {
  if (config.mail.devMode || !transport) {
    logger.info({ to, subject, text }, 'MAIL (dev mode — not sent)');
    return;
  }
  await transport.sendMail({ from: config.mail.from, to, subject, html, text });
}

function shell(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#FBFAF8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1D1D1F">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;padding:36px;border:1px solid #E8E6E1">
    <div style="font-size:17px;font-weight:600;letter-spacing:-.02em;margin-bottom:20px">Lumen</div>
    <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
    <div style="font-size:14px;line-height:1.6;color:#48484D">${body}</div>
    <p style="font-size:12px;color:#6E6E73;margin-top:28px">© 2026 Lumen Labs · Every answer, traced to its source.</p>
  </div></body></html>`;
}

export async function sendVerificationCode(to: string, name: string, code: string) {
  await send(
    to,
    'Your Lumen verification code',
    shell('Verify your email', `<p>Hi ${name},</p><p>Enter this code to verify your email address:</p>
      <p style="font-size:28px;font-weight:600;letter-spacing:8px;font-family:monospace">${code}</p>
      <p style="color:#6E6E73">The code expires in 15 minutes. If you didn't create a Lumen account, you can ignore this email.</p>`),
    `Hi ${name}, your Lumen verification code is ${code}. It expires in 15 minutes.`,
  );
}

export async function sendPasswordResetCode(to: string, name: string, code: string) {
  await send(
    to,
    'Reset your Lumen password',
    shell('Password reset', `<p>Hi ${name},</p><p>Enter this code to choose a new password:</p>
      <p style="font-size:28px;font-weight:600;letter-spacing:8px;font-family:monospace">${code}</p>
      <p style="color:#6E6E73">The code expires in 30 minutes. If you didn't request a reset, your account is still safe — ignore this email.</p>`),
    `Hi ${name}, your Lumen password reset code is ${code}. It expires in 30 minutes.`,
  );
}

export async function sendInvitation(
  to: string,
  inviterName: string,
  workspaceName: string,
  acceptUrl: string,
) {
  await send(
    to,
    `You've been invited to ${workspaceName} on Lumen`,
    shell(`Join ${workspaceName}`,
      `<p>${inviterName} has invited you to collaborate in the workspace “${workspaceName}” on Lumen Document Intelligence.</p>
      <p><a href="${acceptUrl}" style="display:inline-block;background:#0071E3;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:500">Accept invitation</a></p>
      <p style="color:#6E6E73">This link expires in 7 days.</p>`),
    `${inviterName} invited you to ${workspaceName} on Lumen. Accept: ${acceptUrl}`,
  );
}
