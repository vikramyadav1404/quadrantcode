/**
 * A published two-question assessment paper over two original problems, each
 * with a C++ template (the assessment engine opens every answer on C++).
 * Shared by the assessment service and upsolve tests.
 */
import {
  assessmentPaperQuestions,
  assessmentPapers,
  companies,
  contentLicenses,
  problemLanguageTemplates,
  problemVersions,
  problems,
} from '@/server/db/schema';
import { type TestContext, createUser } from './db';

export async function createPaperFixture(ctx: TestContext, durationMinutes = 60) {
  const user = await createUser(ctx.db);
  const [company] = await ctx.db
    .insert(companies)
    .values({ slug: 'timer-company', name: 'Timer Company', overview: 'A test company.' })
    .returning();
  const [license] = await ctx.db
    .insert(contentLicenses)
    .values({
      provenance: 'quadrantcode-original',
      licenseName: `Assessment test ${durationMinutes}`,
      author: 'Quadrantcode tests',
    })
    .returning();

  const createdProblems = [];
  for (let index = 1; index <= 2; index += 1) {
    const [problem] = await ctx.db
      .insert(problems)
      .values({
        slug: `assessment-problem-${durationMinutes}-${index}`,
        title: `Assessment Problem ${index}`,
        sourceType: 'original',
        difficulty: index === 1 ? 'easy' : 'medium',
        status: 'published',
        statement: `Original assessment statement ${index}.`,
      })
      .returning();
    const [version] = await ctx.db
      .insert(problemVersions)
      .values({
        problemId: problem!.id,
        version: 1,
        status: 'published',
        problemType: 'function',
        story: 'Original assessment fixture story.',
        statement: 'Return a deterministic test value from the supplied input.',
        inputFormat: 'One JSON value.',
        outputFormat: 'One JSON value.',
        functionContract: {
          functionName: 'solve',
          parameters: [{ name: 'value', type: 'integer', description: 'Input value.' }],
          returnType: 'integer',
        },
        constraints: ['0 <= value <= 100'],
        hints: ['Return the value.'],
        timeLimitMs: 1_000,
        memoryLimitKb: 64_000,
        contentLicenseId: license!.id,
        provenance: 'Independent assessment fixture.',
        publishedAt: new Date(),
      })
      .returning();
    await ctx.db.insert(problemLanguageTemplates).values({
      problemVersionId: version!.id,
      language: 'cpp17',
      displayName: 'C++',
      functionSignature: 'int solve(int value)',
      starterCode: 'int solve(int value) { return 0; }',
      wrapperTemplate: '/*__USER_CODE__*/\nint main() { return 0; }',
      serialization: { input: 'JSON integer', output: 'JSON integer', equality: 'exact_json' },
      referenceSolution: 'int solve(int value) { return value; }',
    });
    createdProblems.push(problem!);
  }

  const [paper] = await ctx.db
    .insert(assessmentPapers)
    .values({
      companyId: company!.id,
      slug: `timer-paper-${durationMinutes}`,
      title: 'Server Timer Paper',
      role: 'Software Engineer',
      patternPeriod: 'Current practice pattern',
      paperType: 'pattern_based_mock',
      durationMinutes,
      instructions: 'Solve both original questions before the server deadline.',
      status: 'published',
      contentLicenseId: license!.id,
    })
    .returning();
  const questions = await ctx.db
    .insert(assessmentPaperQuestions)
    .values(
      createdProblems.map((problem, index) => ({
        paperId: paper!.id,
        problemId: problem.id,
        ordinal: index + 1,
        marks: (index + 1) * 10,
      })),
    )
    .returning();
  return { user, paper: paper!, questions, problems: createdProblems };
}
