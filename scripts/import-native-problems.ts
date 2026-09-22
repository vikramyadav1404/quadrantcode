import { readFile } from 'node:fs/promises';
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import {
  importNativeProblemLibrary,
  loadNativeProblemBatches,
} from '@/server/services/native-content';
import {
  importAssessmentPaperLibrary,
  loadAssessmentPaperLibrary,
} from '@/server/services/assessments';
import { requireDirectDatabaseUrl } from '@/server/db/direct-url';

const companySeedSchema = z.array(
  z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(2),
    overview: z.string().min(40),
  }),
);

const url = requireDirectDatabaseUrl(process.env, 'import the native library');

const batches = await loadNativeProblemBatches();
const paperLibrary = await loadAssessmentPaperLibrary();
const companySeeds = companySeedSchema.parse(
  JSON.parse(await readFile('data/companies.json', 'utf8')),
);
const client = postgres(url, { max: 1 });

try {
  const problems = await importNativeProblemLibrary(
    drizzle(client, { casing: 'snake_case' }) as never,
    batches,
    companySeeds,
  );
  /*
   * No active paper library since 2026-09-22 — F4.5's twenty papers were
   * retired with the duplicate problems they referenced. `null` is the absence,
   * not an error: importing nothing is the correct outcome until one exists.
   */
  const papers = paperLibrary
    ? await importAssessmentPaperLibrary(
        drizzle(client, { casing: 'snake_case' }) as never,
        paperLibrary,
      )
    : { papers: 0, questions: 0, skipped: 'no active paper library' };
  console.log(JSON.stringify({ problems, papers }, null, 2));
} finally {
  await client.end();
}
