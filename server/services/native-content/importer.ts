/**
 * Imports the native problem library into the database.
 *
 * ## One statement per table, not one per row
 *
 * This used to import a problem at a time, and inside each problem a row at a
 * time: a license, the problem, its version lookup, then every example, test,
 * template, topic and tag as its own INSERT. About thirty round trips a
 * problem. From a GitHub runner to the production database each round trip is
 * a few hundred milliseconds, so the 46-problem library took 10m25s on
 * 2026-11-14 and the first attempt was killed by the workflow's 10-minute
 * timeout. Every new batch would have made it longer.
 *
 * It now issues a fixed number of statements however large the library is:
 * one multi-row upsert per table, with the wide tables (tests, templates)
 * chunked so no single statement grows without bound.
 *
 * ## What did NOT change
 *
 * The end state is the same as the row-at-a-time version, statement for
 * statement:
 *   - one transaction under the same advisory lock, so a failure anywhere —
 *     including "version N changed" — rolls the whole import back;
 *   - problems upserted by slug with the same columns overwritten, and
 *     `status` never touched, so a published problem stays published;
 *   - versions created only when missing, and an existing version whose
 *     statement differs is still refused;
 *   - every child row inserted with ON CONFLICT DO NOTHING, so a re-import adds
 *     anything missing and changes nothing present;
 *   - the license row keeps the values of the last problem that names it,
 *     which is what the sequential updates used to leave behind;
 *   - new problems are inserted in library order, so `problems.number` is
 *     assigned in the same order as before.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db/client';
import {
  companies,
  contentLicenses,
  editorials,
  problemCompanyEvidence,
  problemExamples,
  problemLanguageTemplates,
  problemTags,
  problemTopics,
  problemVersions,
  problems,
  testCases,
  topics,
} from '@/server/db/schema';
import { EXECUTION_LANGUAGES } from '@/lib/execution/languages';
import type { NativeProblem, NativeProblemBatch } from './schema';
import { validateNativeLibrary } from './schema';

export type CompanySeed = { slug: string; name: string; overview: string };

export type NativeImportResult = {
  problems: number;
  versionsCreated: number;
  versionsUnchanged: number;
};

type DbExecutor = Database | Transaction;

/**
 * Rows per statement for the wide tables. A test case carries up to 64 KiB of
 * input, so a hundred of them is a few megabytes at worst — large enough to
 * keep round trips down, small enough to stay far from any protocol limit
 * (65,535 bind parameters; the widest table here binds about a dozen a row).
 */
const CHUNK = 100;

function chunks<T>(rows: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < rows.length; start += size)
    out.push(rows.slice(start, start + size));
  return out;
}

/** `excluded.<column>`: the value the conflicting INSERT row proposed. */
const excluded = (column: string) => sql.raw(`excluded."${column}"`);

async function upsertCompanies(db: DbExecutor, seeds: readonly CompanySeed[]) {
  const bySlug = new Map<string, string>();
  // Last seed wins for a repeated slug, as the sequential upserts did; a
  // multi-row upsert may not touch the same row twice.
  const unique = [...new Map(seeds.map((seed) => [seed.slug, seed])).values()];
  if (unique.length === 0) return bySlug;

  const rows = await db
    .insert(companies)
    .values(unique)
    .onConflictDoUpdate({
      target: companies.slug,
      set: { name: excluded('name'), overview: excluded('overview'), isActive: true },
    })
    .returning({ id: companies.id, slug: companies.slug });
  for (const row of rows) bySlug.set(row.slug, row.id);
  for (const seed of unique) {
    if (!bySlug.has(seed.slug)) throw new Error(`Could not upsert company ${seed.slug}.`);
  }
  return bySlug;
}

const licenseKey = (problem: NativeProblem) =>
  JSON.stringify([
    problem.provenance.contentSource,
    problem.provenance.licenseName,
    problem.provenance.author,
  ]);

async function upsertLicenses(
  db: DbExecutor,
  library: readonly NativeProblem[],
): Promise<Map<string, string>> {
  // The last problem naming a license decides its url and notes.
  const lastByKey = new Map<string, NativeProblem>();
  for (const problem of library) lastByKey.set(licenseKey(problem), problem);

  const rows = await db
    .insert(contentLicenses)
    .values(
      [...lastByKey.values()].map((problem) => ({
        provenance: problem.provenance.contentSource,
        licenseName: problem.provenance.licenseName,
        licenseUrl: problem.provenance.licenseUrl,
        author: problem.provenance.author,
        independentlyCreated: problem.provenance.independentlyCreated,
        reviewNotes: problem.provenance.note,
      })),
    )
    .onConflictDoUpdate({
      target: [contentLicenses.provenance, contentLicenses.licenseName, contentLicenses.author],
      set: {
        licenseUrl: excluded('license_url'),
        independentlyCreated: true,
        reviewNotes: excluded('review_notes'),
      },
    })
    .returning({
      id: contentLicenses.id,
      provenance: contentLicenses.provenance,
      licenseName: contentLicenses.licenseName,
      author: contentLicenses.author,
    });

  const idByKey = new Map<string, string>();
  for (const row of rows) {
    idByKey.set(JSON.stringify([row.provenance, row.licenseName, row.author]), row.id);
  }
  for (const problem of library) {
    if (!idByKey.has(licenseKey(problem))) {
      throw new Error(`Could not upsert content license for ${problem.slug}.`);
    }
  }
  return idByKey;
}

async function upsertProblems(
  db: DbExecutor,
  library: readonly NativeProblem[],
): Promise<Map<string, string>> {
  const idBySlug = new Map<string, string>();
  for (const batch of chunks(library)) {
    const rows = await db
      .insert(problems)
      .values(
        batch.map((problem) => ({
          slug: problem.slug,
          title: problem.title,
          sourceType: 'original' as const,
          difficulty: problem.difficulty,
          estimatedMinutes: problem.estimatedMinutes,
          status: problem.status,
          difficultyCalibration: problem.difficultyCalibration,
          currentVersion: problem.version,
          statement: problem.statement,
          inputFormat: problem.inputFormat,
          outputFormat: problem.outputFormat,
          constraintsText: problem.constraints.join('\n'),
          examples: problem.examples,
          editorial: problem.editorial.overview,
        })),
      )
      .onConflictDoUpdate({
        target: problems.slug,
        // `status` is deliberately absent: re-importing must never unpublish.
        set: {
          title: excluded('title'),
          difficulty: excluded('difficulty'),
          estimatedMinutes: excluded('estimated_minutes'),
          difficultyCalibration: excluded('difficulty_calibration'),
          currentVersion: excluded('current_version'),
          statement: excluded('statement'),
          inputFormat: excluded('input_format'),
          outputFormat: excluded('output_format'),
          constraintsText: excluded('constraints_text'),
          examples: excluded('examples'),
          editorial: excluded('editorial'),
        },
      })
      .returning({ id: problems.id, slug: problems.slug });
    for (const row of rows) idBySlug.set(row.slug, row.id);
  }
  for (const problem of library) {
    if (!idBySlug.has(problem.slug))
      throw new Error(`Could not upsert problem ${problem.slug}.`);
  }
  return idBySlug;
}

/**
 * The version row for each problem: the existing one when its statement
 * matches, a new one when there is none, and an error — rolling the whole
 * import back — when the stored statement differs.
 */
async function resolveVersions(
  db: DbExecutor,
  library: readonly NativeProblem[],
  problemIds: ReadonlyMap<string, string>,
  licenseIds: ReadonlyMap<string, string>,
): Promise<{ versionBySlug: Map<string, string>; created: number }> {
  const existing = await db
    .select({
      id: problemVersions.id,
      problemId: problemVersions.problemId,
      version: problemVersions.version,
      statement: problemVersions.statement,
    })
    .from(problemVersions)
    .where(inArray(problemVersions.problemId, [...problemIds.values()]));

  const existingByKey = new Map(
    existing.map((row) => [`${row.problemId}:${row.version}`, row]),
  );
  const versionBySlug = new Map<string, string>();
  const missing: NativeProblem[] = [];

  for (const problem of library) {
    const found = existingByKey.get(`${problemIds.get(problem.slug)}:${problem.version}`);
    if (!found) {
      missing.push(problem);
      continue;
    }
    if (found.statement !== problem.statement) {
      throw new Error(
        `${problem.slug} version ${problem.version} changed. Bump the version instead of mutating history.`,
      );
    }
    versionBySlug.set(problem.slug, found.id);
  }

  for (const batch of chunks(missing)) {
    const rows = await db
      .insert(problemVersions)
      .values(
        batch.map((problem) => ({
          problemId: problemIds.get(problem.slug)!,
          version: problem.version,
          status: problem.status,
          problemType: problem.problemType,
          story: problem.story,
          statement: problem.statement,
          inputFormat: problem.inputFormat,
          outputFormat: problem.outputFormat,
          functionContract: problem.functionContract,
          constraints: problem.constraints,
          hints: problem.hints,
          timeLimitMs: problem.timeLimitMs,
          memoryLimitKb: problem.memoryLimitKb,
          contentLicenseId: licenseIds.get(licenseKey(problem))!,
          provenance: problem.provenance.note,
          reviewNotes: 'Imported in NEEDS_REVIEW; publishing requires provider validation.',
        })),
      )
      .returning({ id: problemVersions.id, problemId: problemVersions.problemId });
    const slugById = new Map(
      batch.map((problem) => [problemIds.get(problem.slug)!, problem.slug]),
    );
    for (const row of rows) versionBySlug.set(slugById.get(row.problemId)!, row.id);
  }
  for (const problem of missing) {
    if (!versionBySlug.has(problem.slug)) {
      throw new Error(`Could not create problem version for ${problem.slug}.`);
    }
  }

  return { versionBySlug, created: missing.length };
}

async function insertChildren(
  db: DbExecutor,
  library: readonly NativeProblem[],
  versionBySlug: ReadonlyMap<string, string>,
) {
  const versionOf = (problem: NativeProblem) => versionBySlug.get(problem.slug)!;

  const exampleRows = library.flatMap((problem) =>
    problem.examples.map((example, index) => ({
      problemVersionId: versionOf(problem),
      ordinal: index + 1,
      ...example,
    })),
  );
  for (const batch of chunks(exampleRows)) {
    await db.insert(problemExamples).values(batch).onConflictDoNothing();
  }

  const editorialRows = library.map((problem) => ({
    problemVersionId: versionOf(problem),
    ...problem.editorial,
  }));
  for (const batch of chunks(editorialRows)) {
    await db.insert(editorials).values(batch).onConflictDoNothing();
  }

  const testRows = library.flatMap((problem) =>
    problem.testCases.map((testCase, index) => ({
      problemVersionId: versionOf(problem),
      ordinal: index + 1,
      visibility: testCase.visibility,
      coverage: testCase.coverage,
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      explanation: testCase.explanation ?? null,
      isPerformance: testCase.isPerformance,
    })),
  );
  for (const batch of chunks(testRows)) {
    await db.insert(testCases).values(batch).onConflictDoNothing();
  }

  const templateRows = library.flatMap((problem) =>
    EXECUTION_LANGUAGES.map((language) => ({
      problemVersionId: versionOf(problem),
      language,
      ...problem.languages[language],
    })),
  );
  for (const batch of chunks(templateRows)) {
    await db.insert(problemLanguageTemplates).values(batch).onConflictDoNothing();
  }
}

async function attachTopics(
  db: DbExecutor,
  library: readonly NativeProblem[],
  problemIds: ReadonlyMap<string, string>,
) {
  const slugs = [...new Set(library.flatMap((problem) => problem.topics))];
  if (slugs.length === 0) return;

  /*
   * The no-op `slug = excluded.slug` is what makes RETURNING include rows that
   * already existed; DO NOTHING would return only the new ones.
   */
  const topicRows = await db
    .insert(topics)
    .values(slugs.map((slug) => ({ slug, name: slug.split('-').map(capitalize).join(' ') })))
    .onConflictDoUpdate({ target: topics.slug, set: { slug: excluded('slug') } })
    .returning({ id: topics.id, slug: topics.slug });
  const topicIds = new Map(topicRows.map((row) => [row.slug, row.id]));
  for (const slug of slugs) {
    if (!topicIds.has(slug)) throw new Error(`Could not upsert topic ${slug}.`);
  }

  const links = library.flatMap((problem) =>
    problem.topics.map((topicSlug) => ({
      problemId: problemIds.get(problem.slug)!,
      topicId: topicIds.get(topicSlug)!,
      isPrimary: topicSlug === problem.primaryTopic,
    })),
  );
  for (const batch of chunks(links)) {
    await db.insert(problemTopics).values(batch).onConflictDoNothing();
  }

  const tags = library.flatMap((problem) =>
    problem.topics.map((topicSlug) => ({
      problemId: problemIds.get(problem.slug)!,
      tagType: 'topic' as const,
      tagValue: topicSlug,
    })),
  );
  for (const batch of chunks(tags)) {
    await db.insert(problemTags).values(batch).onConflictDoNothing();
  }
}

/**
 * Company evidence stays row at a time: it is a lookup-then-insert on a key
 * with nullable parts, the library has almost none of it, and batching it
 * would buy nothing.
 */
async function attachCompanyEvidence(
  db: DbExecutor,
  library: readonly NativeProblem[],
  problemIds: ReadonlyMap<string, string>,
  companyIds: ReadonlyMap<string, string>,
) {
  for (const problem of library) {
    const problemId = problemIds.get(problem.slug)!;
    for (const association of problem.companies) {
      const companyId = companyIds.get(association.companySlug);
      if (!companyId) throw new Error(`Unknown company ${association.companySlug}.`);

      const [existingEvidence] = await db
        .select({ id: problemCompanyEvidence.id })
        .from(problemCompanyEvidence)
        .where(
          and(
            eq(problemCompanyEvidence.problemId, problemId),
            eq(problemCompanyEvidence.companyId, companyId),
            eq(problemCompanyEvidence.evidenceType, association.evidenceType),
            sql`${problemCompanyEvidence.role} is not distinct from ${association.role}`,
            sql`${problemCompanyEvidence.round} is not distinct from ${association.round}`,
            sql`${problemCompanyEvidence.yearFrom} is not distinct from ${association.yearFrom}`,
          ),
        )
        .limit(1);

      if (!existingEvidence) {
        await db.insert(problemCompanyEvidence).values({
          problemId,
          companyId,
          role: association.role,
          round: association.round,
          candidateLevel: association.candidateLevel,
          yearFrom: association.yearFrom,
          yearTo: association.yearTo,
          location: association.location,
          evidenceType: association.evidenceType,
          sourceUrl: association.sourceUrl,
          reportCount: association.reportCount,
          confidenceScore: association.confidenceScore,
          verificationStatus: association.verificationStatus,
          lastReviewedDate: association.lastReviewedDate,
        });
      }
    }
  }
}

export async function importNativeProblemLibrary(
  db: Database,
  batches: readonly NativeProblemBatch[],
  companySeeds: readonly CompanySeed[],
): Promise<NativeImportResult> {
  const summary = validateNativeLibrary(batches);
  const library = [...batches]
    .sort((left, right) => left.batch - right.batch)
    .flatMap((batch) => batch.problems);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('quadrantcode-native-import'))`);
    const companyIds = await upsertCompanies(tx, companySeeds);
    if (library.length === 0) {
      return { problems: summary.total, versionsCreated: 0, versionsUnchanged: 0 };
    }

    const licenseIds = await upsertLicenses(tx, library);
    const problemIds = await upsertProblems(tx, library);
    const { versionBySlug, created } = await resolveVersions(
      tx,
      library,
      problemIds,
      licenseIds,
    );
    await insertChildren(tx, library, versionBySlug);
    await attachTopics(tx, library, problemIds);
    await attachCompanyEvidence(tx, library, problemIds, companyIds);

    return {
      problems: summary.total,
      versionsCreated: created,
      versionsUnchanged: library.length - created,
    };
  });
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}
