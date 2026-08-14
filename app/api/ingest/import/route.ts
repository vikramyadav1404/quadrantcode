/**
 * POST /api/ingest/import — upload a CSV.
 *
 * The file DOES pass through this handler, unlike avatars in F0.5, and the
 * difference is deliberate rather than inconsistent: the import cap is 2 MiB,
 * comfortably under Vercel's ~4.5 MiB serverless body limit, whereas an avatar
 * could exceed it. Presigning would also be wrong here — the server has to read
 * the bytes to validate them, so handing the browser a direct-to-storage URL
 * would only move the file somewhere we then have to fetch it back from.
 *
 * `?preview=1` validates and returns per-row verdicts WITHOUT writing anything,
 * which is what the preview table renders before the user confirms.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import { RATE_LIMITS, createRateLimiter } from '@/server/lib/ratelimit';
import { getCurrentUser } from '@/server/services/auth/session';
import {
  IMPORT_LIMITS,
  ImportFileTooLargeError,
  ImportMissingColumnsError,
  ImportTooManyRowsError,
  ImportUnreadableError,
  InProcessJobRunner,
  parseImportCsv,
  startImport,
} from '@/server/services/ingest';
import { rowsForJob } from '@/server/services/ingest/job-rows';

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  }

  const preview = new URL(request.url).searchParams.get('preview') === '1';

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, message: 'Attach a CSV file under the "file" field.' },
      { status: 400 },
    );
  }

  /*
   * Size is checked HERE as well, before the bytes are read into memory.
   *
   * `parseImportCsv` checks it too and that check is the real one — but reading
   * a 50 MiB upload into a Buffer only to reject it afterwards is the exact
   * "cap that protects nothing" this ticket keeps avoiding. `File.size` is
   * known without reading the body.
   */
  if (file.size > IMPORT_LIMITS.maxBytes) {
    return NextResponse.json(
      {
        ok: false,
        code: 'IMPORT_FILE_TOO_LARGE',
        message: `That file is ${Math.ceil(file.size / 1024)} KB. The limit is ${IMPORT_LIMITS.maxBytes / 1024} KB.`,
      },
      { status: 413 },
    );
  }

  const env = getServerEnv();

  // The preview path writes nothing, but it still parses up to 5,000 rows, so
  // it is rate limited on the same bucket as the real thing.
  const gate = await createRateLimiter(RATE_LIMITS.importPerUser, env).limit(user.id);
  if (!gate.allowed) {
    return NextResponse.json(
      { ok: false, message: 'Too many imports this hour. Try again later.' },
      { status: 429 },
    );
  }

  const content = Buffer.from(await file.arrayBuffer());
  const db = getDb();

  try {
    if (preview) {
      const parsed = await parseImportCsv(content);
      return NextResponse.json({
        ok: true,
        totalRows: parsed.totalRows,
        validCount: parsed.valid.length,
        // Capped: a 5,000-row file with 5,000 errors would otherwise return a
        // response larger than the upload.
        invalid: parsed.invalid.slice(0, 100),
        invalidCount: parsed.invalid.length,
        willRunAsJob: parsed.totalRows > IMPORT_LIMITS.jobThresholdRows,
      });
    }

    const runner = new InProcessJobRunner(db, (jobId) => rowsForJob(db, jobId));
    const result = await startImport(
      db,
      user.id,
      { name: file.name || 'import.csv', content },
      runner,
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (
      error instanceof ImportFileTooLargeError ||
      error instanceof ImportTooManyRowsError ||
      error instanceof ImportMissingColumnsError ||
      error instanceof ImportUnreadableError
    ) {
      return NextResponse.json(
        { ok: false, code: error.code, message: error.message },
        { status: error instanceof ImportFileTooLargeError ? 413 : 400 },
      );
    }
    throw error;
  }
}
