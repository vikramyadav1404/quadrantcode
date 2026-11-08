/**
 * POST /api/admin/catalog-import: the admin's bulk import of external-link
 * problems into the PUBLIC catalog (`/admin/problems/import`).
 *
 *   ?preview=1   parse and count, write nothing
 *   ?offset=N    import unique valid rows [N, N + chunk) and say where to go next
 *
 * The browser drives the chunks, one request each, re-sending the same file.
 * Re-parsing costs milliseconds; in exchange nothing is held between requests,
 * no request comes near the 60 s limit, and a closed tab loses nothing, since
 * every write is keyed on the normalised URL (see `server/services/ingest/catalog.ts`).
 *
 * Admin only, checked here (middleware only checks that a session exists). The
 * session cookie is `SameSite=lax`, so another site cannot post here with it;
 * the Origin check below is a second, explicit refusal of a cross-site request.
 */
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import {
  CATALOG_IMPORT_LIMITS,
  ImportFileTooLargeError,
  ImportMissingColumnsError,
  ImportTooManyRowsError,
  ImportUnreadableError,
  importCatalogChunk,
  parseImportCsv,
  previewCatalogImport,
  uniqueByUrl,
} from '@/server/services/ingest';
import { AuthenticationError, AuthorizationError } from '@/server/services/auth/rbac';
import { requireCurrentUser } from '@/server/services/auth/session';

export const runtime = 'nodejs';
export const maxDuration = 60;

function refuse(status: number, message: string): NextResponse {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  let admin: { id: string };
  try {
    admin = await requireCurrentUser('admin');
  } catch (error) {
    if (error instanceof AuthenticationError) return refuse(401, 'Sign in first.');
    if (error instanceof AuthorizationError) return refuse(403, 'Admins only.');
    throw error;
  }

  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) {
    return refuse(403, 'Cross-site requests are not accepted.');
  }

  const params = new URL(request.url).searchParams;
  const preview = params.get('preview') === '1';
  const offset = Number(params.get('offset') ?? '0');
  if (!preview && (!Number.isInteger(offset) || offset < 0)) {
    return refuse(400, 'The offset must be a whole number, 0 or more.');
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return refuse(400, 'Attach a CSV file under the "file" field.');

  // A cheap early answer; `parseImportCsv` checks the real byte length too.
  if (file.size > CATALOG_IMPORT_LIMITS.maxBytes) {
    return refuse(
      413,
      `That file is ${Math.ceil(file.size / 1024)} KB. The limit is ${CATALOG_IMPORT_LIMITS.maxBytes / 1024} KB; split it into smaller files.`,
    );
  }

  const db = getDb();
  try {
    const parsed = await parseImportCsv(
      Buffer.from(await file.arrayBuffer()),
      CATALOG_IMPORT_LIMITS,
    );

    if (preview) {
      return NextResponse.json({
        ok: true,
        chunkRows: CATALOG_IMPORT_LIMITS.chunkRows,
        ...(await previewCatalogImport(db, parsed)),
      });
    }

    const { unique } = uniqueByUrl(parsed.valid);
    const chunk = unique.slice(offset, offset + CATALOG_IMPORT_LIMITS.chunkRows);
    const result = await importCatalogChunk(db, chunk, admin.id);
    const processed = Math.min(offset + chunk.length, unique.length);
    const done = processed >= unique.length;

    if (done) {
      revalidatePath('/problems');
      revalidatePath('/admin/problems');
    }

    return NextResponse.json({
      ok: true,
      ...result,
      processed,
      total: unique.length,
      nextOffset: done ? null : processed,
    });
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
