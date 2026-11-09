import { connect, createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SmtpError,
  buildMessage,
  dotStuff,
  sendViaSmtp,
  signInEmail,
} from '@/server/services/auth/gmail-smtp';

/**
 * A scripted SMTP server on localhost. It speaks plain TCP — the client's
 * `connect` hook replaces TLS — and records every command it receives.
 */
function fakeSmtp(
  overrides: Partial<Record<'AUTH' | 'RCPT', string>> = {},
): Promise<{ server: Server; port: number; commands: string[]; data: () => string }> {
  const commands: string[] = [];
  let data = '';
  return new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      let buffer = '';
      let inData = false;
      socket.write('220 fake ready\r\n');
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let index: number;
        while ((index = buffer.indexOf('\r\n')) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (inData) {
            if (line === '.') {
              inData = false;
              socket.write('250 queued\r\n');
            } else {
              data += line + '\r\n';
            }
            continue;
          }
          commands.push(line);
          if (line.startsWith('EHLO')) socket.write('250-fake\r\n250-AUTH PLAIN\r\n250 OK\r\n');
          else if (line.startsWith('AUTH')) socket.write(overrides.AUTH ?? '235 accepted\r\n');
          else if (line.startsWith('MAIL FROM')) socket.write('250 ok\r\n');
          else if (line.startsWith('RCPT TO')) socket.write(overrides.RCPT ?? '250 ok\r\n');
          else if (line === 'DATA') {
            inData = true;
            socket.write('354 go\r\n');
          } else if (line === 'QUIT') socket.end('221 bye\r\n');
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port, commands, data: () => data });
    });
  });
}

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

const message = {
  from: 'Quadrantcode <me@gmail.com>',
  to: 'student@example.com',
  ...signInEmail('https://quadrantcode.example/api/auth/callback/gmail?token=abc&email=x'),
};

describe('sendViaSmtp', () => {
  it('authenticates, sends one message and quits', async () => {
    const fake = await fakeSmtp();
    servers.push(fake.server);

    await sendViaSmtp({ user: 'me@gmail.com', pass: 'app-password' }, message, {
      host: '127.0.0.1',
      port: fake.port,
      connect: (host, port) => connect(port, host),
    });

    expect(fake.commands[0]).toBe('EHLO quadrantcode');
    const auth = fake.commands.find((line) => line.startsWith('AUTH PLAIN '));
    expect(Buffer.from(auth!.slice('AUTH PLAIN '.length), 'base64').toString()).toBe(
      '\0me@gmail.com\0app-password',
    );
    expect(fake.commands).toContain('MAIL FROM:<me@gmail.com>');
    expect(fake.commands).toContain('RCPT TO:<student@example.com>');
    expect(fake.data()).toContain('Subject: Your Quadrantcode sign-in link');
  });

  it('rejects with the step and code when the server refuses AUTH', async () => {
    const fake = await fakeSmtp({ AUTH: '535 5.7.8 bad credentials\r\n' });
    servers.push(fake.server);

    await expect(
      sendViaSmtp({ user: 'me@gmail.com', pass: 'wrong' }, message, {
        host: '127.0.0.1',
        port: fake.port,
        connect: (host, port) => connect(port, host),
      }),
    ).rejects.toMatchObject({
      name: 'SmtpError',
      code: 535,
      message: 'SMTP AUTH failed with 535',
    });
    expect(fake.commands.some((line) => line.startsWith('MAIL FROM'))).toBe(false);
  });

  it('times out instead of hanging on a silent server', async () => {
    const silent = createServer(() => {});
    servers.push(silent);
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const address = silent.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    await expect(
      sendViaSmtp({ user: 'me@gmail.com', pass: 'x' }, message, {
        host: '127.0.0.1',
        port,
        timeoutMs: 200,
        connect: (host, p) => connect(p, host),
      }),
    ).rejects.toBeInstanceOf(SmtpError);
  });
});

describe('buildMessage', () => {
  it('refuses a recipient that would inject a header', () => {
    expect(() =>
      buildMessage({ ...message, to: 'a@example.com\r\nBcc: victim@example.com' }),
    ).toThrow(SmtpError);
  });

  it('refuses a subject with a line break', () => {
    expect(() => buildMessage({ ...message, subject: 'hi\r\nBcc: x@y.z' })).toThrow(SmtpError);
  });

  it('carries both parts as base64 and the link in each', () => {
    const built = buildMessage(message);
    const parts = built.split('Content-Transfer-Encoding: base64\r\n\r\n').slice(1);
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      const body = part.split('\r\n--')[0]!.replace(/\r\n/g, '');
      expect(Buffer.from(body, 'base64').toString()).toContain('quadrantcode.example');
    }
  });
});

describe('dotStuff', () => {
  it('doubles a leading dot on any line', () => {
    expect(dotStuff('.a\r\nb\r\n.c')).toBe('..a\r\nb\r\n..c');
  });
});

describe('signInEmail', () => {
  it('escapes the URL inside the HTML attribute', () => {
    const { html } = signInEmail('https://x.example/?a=1&b="2"');
    expect(html).toContain('href="https://x.example/?a=1&amp;b=&quot;2&quot;"');
  });
});
