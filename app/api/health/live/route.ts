import { NextResponse } from 'next/server';

/** Process liveness only. It deliberately performs no network or database I/O. */
export function GET(): NextResponse {
  return NextResponse.json(
    { status: 'alive', checkedAt: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
