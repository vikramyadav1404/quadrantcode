import { ImageResponse } from 'next/og';
import { TOKENS } from '@/lib/design-tokens';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  const colors = TOKENS.dark;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        background: colors.background,
      }}
    >
      <div style={{ display: 'flex', flex: 1, gap: 6 }}>
        <div style={{ flex: 1, background: colors['text-primary'] }} />
        <div style={{ flex: 1, background: colors.accent }} />
      </div>
      <div style={{ display: 'flex', flex: 1, gap: 6 }}>
        <div style={{ flex: 1, background: colors['text-primary'] }} />
        <div style={{ flex: 1, background: colors['text-primary'] }} />
      </div>
    </div>,
    size,
  );
}
