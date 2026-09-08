/**
 * Resolve the address used for abuse controls.
 *
 * Vercel overwrites x-forwarded-for and supplies x-vercel-forwarded-for, so a
 * browser cannot spoof it. Outside Vercel, forwarded headers are trusted only
 * when TRUST_PROXY=1; otherwise callers share a conservative `unknown` bucket.
 */
export function clientIp(request: Request): string {
  const headers = request.headers;
  const onVercel = Boolean(headers.get('x-vercel-id') || process.env.VERCEL === '1');
  const candidate = onVercel
    ? (headers.get('x-vercel-forwarded-for') ?? headers.get('x-forwarded-for'))
    : process.env.TRUST_PROXY === '1'
      ? (headers.get('x-forwarded-for') ?? headers.get('x-real-ip'))
      : undefined;

  const first = candidate?.split(',')[0]?.trim();
  return first && first.length <= 64 ? first : 'unknown';
}
