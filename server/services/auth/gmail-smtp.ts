/**
 * A minimal SMTP client for ONE job: sending a sign-in link through Gmail.
 *
 * ## Why not nodemailer
 *
 * Auth.js 5 declares nodemailer `^7.0.7 || ^8.0.5` as its peer. Every 8.x is
 * flagged high by `npm audit`, and the fixed 10.x breaks `npm ci` with an
 * ERESOLVE peer conflict — so either the release gate or the install fails.
 * What this file needs from SMTP is small and fixed: implicit TLS, AUTH PLAIN,
 * one recipient, one message. That is easier to read in full than a dependency
 * is to keep patched.
 *
 * ## What it deliberately does not do
 *
 * No attachments, no raw messages, no file or URL content loading — the
 * features the nodemailer advisories were about simply do not exist here.
 * Every header value is checked for CR/LF before it is written, so an address
 * or subject cannot inject a header.
 */
import { randomUUID } from 'node:crypto';
import { connect as tlsConnect } from 'node:tls';
import type { Duplex } from 'node:stream';

export type SmtpCredentials = { user: string; pass: string };

export type SmtpMessage = {
  /** The From header, e.g. `Quadrantcode <me@gmail.com>`. */
  from: string;
  /** One bare address. */
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type SmtpOptions = {
  host?: string;
  port?: number;
  timeoutMs?: number;
  /** Tests inject a plain TCP socket; production always uses implicit TLS. */
  connect?: (host: string, port: number) => Duplex;
};

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

const CRLF = '\r\n';
const BARE_ADDRESS = /^[^\s<>@,;:"\\]+@[^\s<>@,;:"\\]+\.[^\s<>@,;:"\\]+$/;

function assertHeaderSafe(name: string, value: string): void {
  if (/[\r\n]/.test(value)) throw new SmtpError(`${name} contains a line break`, null);
}

function assertAddress(name: string, value: string): void {
  assertHeaderSafe(name, value);
  if (!BARE_ADDRESS.test(value)) throw new SmtpError(`${name} is not a bare address`, null);
}

/** RFC 2047 encoded-word for any non-ASCII header text. */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Base64 wrapped at 76 columns, as RFC 2045 requires. */
function base64Lines(value: string): string {
  return (
    Buffer.from(value, 'utf8')
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join(CRLF) ?? ''
  );
}

/**
 * The full message, CRLF line endings, ready for DATA. Both parts are base64,
 * so no body line can be a lone `.` — dot-stuffing is still applied in
 * `sendViaSmtp`, because correctness should not depend on that.
 */
export function buildMessage(message: SmtpMessage, now: Date = new Date()): string {
  assertHeaderSafe('from', message.from);
  assertAddress('to', message.to);
  assertHeaderSafe('subject', message.subject);

  const boundary = `qc-${randomUUID()}`;
  const domain = message.to.split('@')[1] ?? 'localhost';
  return [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(message.html),
    `--${boundary}--`,
    '',
  ].join(CRLF);
}

/** RFC 5321 §4.5.2: a line starting with `.` gets one more. */
export function dotStuff(data: string): string {
  return data.replace(/(^|\r\n)\./g, '$1..');
}

/**
 * Reads complete SMTP replies off a socket. A reply is complete at the line
 * whose code is followed by a space (`250 OK`); `250-` lines are continuations.
 */
class ReplyReader {
  private buffer = '';
  private waiting: Array<{
    resolve: (reply: { code: number; text: string }) => void;
    reject: (error: Error) => void;
  }> = [];
  private ready: Array<{ code: number; text: string }> = [];
  private failure: Error | null = null;

  constructor(socket: Duplex) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error: Error) => this.fail(error));
    socket.on('close', () => this.fail(new SmtpError('connection closed', null)));
  }

  private drain(): void {
    let index: number;
    let lines: string[] = [];
    while ((index = this.buffer.indexOf(CRLF)) !== -1) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      lines.push(line);
      if (/^\d{3}( |$)/.test(line)) {
        const code = Number(line.slice(0, 3));
        const text = lines.map((entry) => entry.slice(4)).join('\n');
        lines = [];
        const next = this.waiting.shift();
        if (next) next.resolve({ code, text });
        else this.ready.push({ code, text });
      }
    }
    if (lines.length) this.buffer = lines.join(CRLF) + CRLF + this.buffer;
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const entry of this.waiting.splice(0)) entry.reject(error);
  }

  next(): Promise<{ code: number; text: string }> {
    const ready = this.ready.shift();
    if (ready) return Promise.resolve(ready);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }
}

function defaultConnect(host: string, port: number): Duplex {
  return tlsConnect({ host, port, servername: host });
}

export async function sendViaSmtp(
  credentials: SmtpCredentials,
  message: SmtpMessage,
  options: SmtpOptions = {},
): Promise<void> {
  const host = options.host ?? 'smtp.gmail.com';
  const port = options.port ?? 465;
  const timeoutMs = options.timeoutMs ?? 15_000;
  assertAddress('user', credentials.user);
  const data = dotStuff(buildMessage(message));

  const socket = (options.connect ?? defaultConnect)(host, port);
  const reader = new ReplyReader(socket);
  const timer = setTimeout(
    () => socket.destroy(new SmtpError(`SMTP timed out after ${timeoutMs}ms`, null)),
    timeoutMs,
  );

  async function expect(codes: number[], step: string): Promise<void> {
    const reply = await reader.next();
    if (!codes.includes(reply.code)) {
      // The server's text can echo the address; the step and code are enough.
      throw new SmtpError(`SMTP ${step} failed with ${reply.code}`, reply.code);
    }
  }

  function send(line: string): void {
    socket.write(line + CRLF);
  }

  try {
    await expect([220], 'greeting');
    send('EHLO quadrantcode');
    await expect([250], 'EHLO');
    const plain = Buffer.from(`\0${credentials.user}\0${credentials.pass}`, 'utf8').toString(
      'base64',
    );
    send(`AUTH PLAIN ${plain}`);
    await expect([235], 'AUTH');
    send(`MAIL FROM:<${credentials.user}>`);
    await expect([250], 'MAIL FROM');
    send(`RCPT TO:<${message.to}>`);
    await expect([250, 251], 'RCPT TO');
    send('DATA');
    await expect([354], 'DATA');
    socket.write(data.endsWith(CRLF) ? data : data + CRLF);
    send('.');
    await expect([250], 'message');
    send('QUIT');
  } finally {
    clearTimeout(timer);
    socket.end();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The sign-in email. Plain on purpose: one link, no tracking, no images. */
export function signInEmail(url: string): { subject: string; text: string; html: string } {
  const safe = escapeHtml(url);
  return {
    subject: 'Your Quadrantcode sign-in link',
    text:
      `Sign in to Quadrantcode:\n${url}\n\n` +
      'The link works once and expires in 15 minutes. If you did not ask for it, ignore this email.\n',
    html:
      '<p>Sign in to Quadrantcode:</p>' +
      `<p><a href="${safe}">Sign in</a></p>` +
      '<p>The link works once and expires in 15 minutes. If you did not ask for it, ignore this email.</p>',
  };
}
