import { describe, expect, it } from 'vitest';
import {
  EMAIL_PROVIDER_ID,
  gmailFrom,
  normaliseAppPassword,
  resolveEmailDelivery,
} from '@/server/services/auth/email-delivery';

describe('resolveEmailDelivery', () => {
  it('is null when nothing is configured', () => {
    expect(resolveEmailDelivery({})).toBeNull();
  });

  it('picks Resend when its key and From are both set', () => {
    expect(resolveEmailDelivery({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'Q <a@b.c>' })).toBe(
      'resend',
    );
  });

  it('does not treat half a Resend config as Resend', () => {
    expect(resolveEmailDelivery({ RESEND_API_KEY: 're_x' })).toBeNull();
  });

  it('picks Gmail when both Gmail values are set', () => {
    expect(resolveEmailDelivery({ GMAIL_USER: 'me@gmail.com', GMAIL_APP_PASSWORD: 'x' })).toBe(
      'gmail',
    );
  });

  it('prefers Resend when both transports are configured', () => {
    expect(
      resolveEmailDelivery({
        RESEND_API_KEY: 're_x',
        EMAIL_FROM: 'Q <a@b.c>',
        GMAIL_USER: 'me@gmail.com',
        GMAIL_APP_PASSWORD: 'x',
      }),
    ).toBe('resend');
  });

  it('treats whitespace-only values as unset', () => {
    expect(resolveEmailDelivery({ GMAIL_USER: '  ', GMAIL_APP_PASSWORD: 'x' })).toBeNull();
  });

  it('keeps the resend provider id stable for existing callback URLs', () => {
    expect(EMAIL_PROVIDER_ID.resend).toBe('resend');
  });
});

describe('Gmail helpers', () => {
  it('strips the spaces Google shows in app passwords', () => {
    expect(normaliseAppPassword('abcd efgh ijkl mnop')).toBe('abcdefghijklmnop');
  });

  it('defaults From to the Gmail account', () => {
    expect(gmailFrom({ GMAIL_USER: 'me@gmail.com' })).toBe('Quadrantcode <me@gmail.com>');
  });

  it('uses EMAIL_FROM when it is set', () => {
    expect(gmailFrom({ GMAIL_USER: 'me@gmail.com', EMAIL_FROM: 'QC <me@gmail.com>' })).toBe(
      'QC <me@gmail.com>',
    );
  });
});
