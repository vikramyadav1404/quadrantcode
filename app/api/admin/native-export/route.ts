import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getDb } from '@/server/db';
import { buildNativeContentExport, buildNativeSummaryCsv } from '@/server/services/admin';
import { requireCurrentUser } from '@/server/services/auth/session';

export async function GET(request: NextRequest) {
  await requireCurrentUser('admin');
  const scope =
    request.nextUrl.searchParams.get('scope') === 'sensitive' ? 'sensitive' : 'public';
  const format = request.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'json';
  if (scope === 'sensitive' && request.nextUrl.searchParams.get('confirm') !== 'hidden-data')
    return NextResponse.json(
      { error: 'Explicit sensitive-export confirmation is required.' },
      { status: 400 },
    );
  const headers = {
    'cache-control': 'private, no-store',
    'content-disposition': `attachment; filename="quadrantcode-native-${scope}.${format}"`,
    'x-content-type-options': 'nosniff',
  };
  if (format === 'csv')
    return new NextResponse(await buildNativeSummaryCsv(getDb()), {
      headers: { ...headers, 'content-type': 'text/csv; charset=utf-8' },
    });
  return NextResponse.json(await buildNativeContentExport(getDb(), scope === 'sensitive'), {
    headers,
  });
}
