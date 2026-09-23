import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assessmentPapers,
  companies,
  contentLicenses,
  problemCompanyEvidence,
  problemTopics,
  problems,
  topics,
} from '@/server/db/schema';
import { getCompanyPageData } from '@/server/services/companies';
import { type TestContext, hasTestDatabase, setupTestDb, truncateAll } from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

suite('company preparation filters', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 120_000);
  afterAll(async () => ctx?.close());
  beforeEach(async () => truncateAll(ctx.sql));

  it('applies role, round, year, difficulty, topic, and evidence in SQL', async () => {
    const [company] = await ctx.db
      .insert(companies)
      .values({
        slug: 'filter-company',
        name: 'Filter Company',
        overview: 'A descriptive test-company overview that is long enough for this fixture.',
      })
      .returning();
    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: 'filter-native-problem',
        title: 'Filter Native Problem',
        sourceType: 'original',
        difficulty: 'hard',
        status: 'published',
        statement: 'An independently authored query-filter fixture.',
      })
      .returning();
    const [topic] = await ctx.db
      .insert(topics)
      .values({ slug: 'graphs', name: 'Graphs' })
      .returning();
    await ctx.db.insert(problemTopics).values({
      problemId: problem!.id,
      topicId: topic!.id,
      isPrimary: true,
    });
    await ctx.db.insert(problemCompanyEvidence).values({
      problemId: problem!.id,
      companyId: company!.id,
      role: 'Backend Engineer',
      round: 'Technical screen',
      yearFrom: 2025,
      yearTo: 2026,
      /*
       * `unverified`, not `candidate_reported`. The latter is blocked at the
       * database by `problem_company_evidence_no_unreviewed_provenance` (C3),
       * and a fixture using a value the schema forbids tests a row that cannot
       * exist. The filter under test is indifferent to WHICH type it matches.
       */
      evidenceType: 'unverified',
      verificationStatus: 'reviewed',
    });

    const result = await getCompanyPageData(ctx.db, company!.slug, {
      role: 'Backend Engineer',
      round: 'Technical screen',
      year: 2026,
      difficulty: 'hard',
      topic: 'graphs',
      evidence: 'unverified',
    });
    expect(result?.problems).toHaveLength(1);
    expect(result?.problems[0]).toMatchObject({
      slug: problem!.slug,
      evidenceType: 'unverified',
      topics: ['graphs'],
    });
  });

  it('does not expose unpublished papers on company pages', async () => {
    const [company] = await ctx.db
      .insert(companies)
      .values({
        slug: 'paper-company',
        name: 'Paper Company',
        overview: 'A descriptive test-company overview that is long enough for this fixture.',
      })
      .returning();
    const [license] = await ctx.db
      .insert(contentLicenses)
      .values({
        provenance: 'quadrantcode-original',
        licenseName: 'Company paper fixture',
        author: 'Quadrantcode tests',
      })
      .returning();
    await ctx.db.insert(assessmentPapers).values({
      companyId: company!.id,
      slug: 'unpublished-pattern-paper',
      title: 'Unpublished Pattern Paper',
      role: 'Software Engineer',
      patternPeriod: 'Evergreen original pattern',
      paperType: 'pattern_based_mock',
      durationMinutes: 90,
      instructions: 'This independent test mock is deliberately not published to public users.',
      status: 'needs_review',
      contentLicenseId: license!.id,
    });
    expect((await getCompanyPageData(ctx.db, company!.slug, {}))?.papers).toHaveLength(0);
  });
});
