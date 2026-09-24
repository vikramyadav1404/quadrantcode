/**
 * F4.7 · a monthly report card as an image, at one of the three share sizes.
 *
 * `/u/<handle>/card/linkedin|x|whatsapp?month=YYYY-MM`. Public for the same
 * reason the profile page is — a link preview is fetched by a crawler with no
 * session — and gated by the same query: a disabled profile is a 404 here too.
 * Every number on it is one of the owner's enabled sections; a section that is
 * off is absent from the card, not shown as zero.
 */
import { ImageResponse } from 'next/og';
import { TOKENS } from '@/lib/design-tokens';
import { CARD_FORMATS, type CardFormat } from '@/lib/profile/public-view';
import { getDb } from '@/server/db';
import { getMonthlyCard } from '@/server/services/profile';

export const runtime = 'nodejs';

function monthLabel(month: string): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string; format: string }> },
): Promise<Response> {
  const { handle, format } = await params;
  if (!(format in CARD_FORMATS)) return new Response('Not found', { status: 404 });
  const size = CARD_FORMATS[format as CardFormat];

  const month = new URL(request.url).searchParams.get('month') ?? undefined;
  const card = await getMonthlyCard(getDb(), {
    handle,
    now: new Date(),
    ...(month ? { month } : {}),
  });
  if (!card) return new Response('Not found', { status: 404 });

  const colors = TOKENS.dark;
  const square = size.width === size.height;
  const stats = [
    card.solvedThisMonth !== null
      ? { label: 'solved this month', value: card.solvedThisMonth }
      : null,
    card.activeDays !== null ? { label: 'active days', value: card.activeDays } : null,
    card.currentStreak !== null ? { label: 'day streak', value: card.currentStreak } : null,
  ].filter((stat): stat is { label: string; value: number } => stat !== null);

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: square ? 84 : 72,
        color: colors['text-primary'],
        background: colors.background,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ color: colors.accent, fontSize: 26, letterSpacing: 5 }}>QUADRANTCODE</div>
        <div style={{ marginTop: 28, fontSize: square ? 64 : 60, fontWeight: 700 }}>
          {card.displayName}
        </div>
        <div style={{ marginTop: 12, color: colors['text-muted'], fontSize: 32 }}>
          {`${monthLabel(card.month)} practice report`}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: square ? 'column' : 'row',
          gap: square ? 28 : 64,
        }}
      >
        {stats.length === 0 ? (
          <div style={{ color: colors['text-muted'], fontSize: 32 }}>
            {`${card.displayName} keeps their numbers private.`}
          </div>
        ) : (
          stats.map((stat) => (
            <div key={stat.label} style={{ display: 'flex', flexDirection: 'column' }}>
              {/* A string, not a number: satori reads a numeric child as more than
                  one node and refuses the div (reproduced in isolation). */}
              <div style={{ fontSize: square ? 96 : 88, fontWeight: 700 }}>
                {String(stat.value)}
              </div>
              <div style={{ color: colors['text-muted'], fontSize: 30 }}>{stat.label}</div>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26 }}>
        <div style={{ color: colors['text-muted'] }}>
          {card.topTopic ? `Most practised: ${card.topTopic}` : ' '}
        </div>
        <div style={{ color: colors['text-muted'] }}>{`/u/${card.handle}`}</div>
      </div>
    </div>,
    {
      ...size,
      headers: {
        // Numbers move daily; a crawler may cache for an hour, not forever.
        'cache-control': 'public, max-age=3600',
      },
    },
  );
}
