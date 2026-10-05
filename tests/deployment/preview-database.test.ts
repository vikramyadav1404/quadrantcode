/**
 * The Preview-build database check (D30 follow-up). The real production endpoint
 * is not in this repo, so production is simulated with PRODUCTION_DB_HOST, the
 * guard's documented extra-host setting.
 */
import { describe, expect, it } from 'vitest';
import { DATABASE_VARIABLES, previewDatabaseProblems } from '@/lib/deployment/preview-database';

const PROD = 'ep-invented-prod-1a2b-pooler.us-east-2.aws.neon.tech';
const PROD_DIRECT = 'ep-invented-prod-1a2b.us-east-2.aws.neon.tech';
const PREVIEW = 'ep-invented-preview-9z8y.us-east-2.aws.neon.tech';
const url = (host: string) => `postgresql://user:secret-pw@${host}/neondb?sslmode=require`;

describe('previewDatabaseProblems', () => {
  it('names EVERY database variable that points at production, pooled or direct', () => {
    const result = previewDatabaseProblems({
      PRODUCTION_DB_HOST: PROD_DIRECT,
      DATABASE_URL: url(PREVIEW),
      DIRECT_DATABASE_URL: url(PREVIEW),
      DATABASE_URL_UNPOOLED: url(PROD_DIRECT),
      TEST_DATABASE_URL: url(PROD),
    });
    expect(result.production).toEqual(['DATABASE_URL_UNPOOLED', 'TEST_DATABASE_URL']);
    expect(result.unparseable).toEqual([]);
  });

  it('POSITIVE CONTROL · a Preview with its own database everywhere is clean', () => {
    const result = previewDatabaseProblems({
      PRODUCTION_DB_HOST: PROD_DIRECT,
      DATABASE_URL: url(PREVIEW),
      DIRECT_DATABASE_URL: url(PREVIEW),
      DATABASE_URL_UNPOOLED: url(PREVIEW),
    });
    expect(result).toEqual({ production: [], unparseable: [] });
  });

  it('flags a value that is not a URL, because it cannot be checked', () => {
    expect(
      previewDatabaseProblems({ DATABASE_URL_UNPOOLED: '<redacted>' }).unparseable,
    ).toEqual(['DATABASE_URL_UNPOOLED']);
  });

  it('returns names only: no value, host or credential ever leaves it', () => {
    const result = previewDatabaseProblems({
      PRODUCTION_DB_HOST: PROD_DIRECT,
      DATABASE_URL: url(PROD),
      DIRECT_DATABASE_URL: 'garbage secret-pw',
    });
    const printed = JSON.stringify(result);
    expect(printed).not.toContain('secret-pw');
    expect(printed).not.toContain('neon.tech');
    for (const name of [...result.production, ...result.unparseable]) {
      expect(DATABASE_VARIABLES).toContain(name);
    }
  });
});
