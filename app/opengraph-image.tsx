import { ImageResponse } from 'next/og';
import { TOKENS } from '@/lib/design-tokens';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  const colors = TOKENS.dark;
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 72,
        color: colors['text-primary'],
        background: colors.background,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 820 }}>
        <div style={{ color: colors.accent, fontSize: 24, letterSpacing: 5 }}>QUADRANTCODE</div>
        <div style={{ marginTop: 34, fontSize: 72, fontWeight: 700, lineHeight: 1.05 }}>
          Every solve leaves a signal.
        </div>
        <div style={{ marginTop: 28, color: colors['text-muted'], fontSize: 30 }}>
          Practice intelligence for deliberate coders.
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: 150,
          height: 150,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', flex: 1, gap: 12 }}>
          <div style={{ flex: 1, background: colors['text-primary'] }} />
          <div style={{ flex: 1, background: colors.accent }} />
        </div>
        <div style={{ display: 'flex', flex: 1, gap: 12 }}>
          <div style={{ flex: 1, background: colors['text-primary'] }} />
          <div style={{ flex: 1, background: colors['text-primary'] }} />
        </div>
      </div>
    </div>,
    size,
  );
}
