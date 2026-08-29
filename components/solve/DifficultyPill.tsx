/**
 * Difficulty as a badge.
 *
 * Colour is never the only signal — the word is always there. A pill that says
 * "Hard" in red still says "Hard" to somebody who cannot tell it from the green
 * one, which is the rule `npm run contrast` and F0.4 set for every status
 * colour in this project.
 *
 * The tokens are the project's own (`--success` / `--warning` / `--danger`),
 * not another site's palette. They are already contrast-audited against both
 * surfaces.
 */
const STYLES: Record<string, { token: string; label: string }> = {
  easy: { token: 'var(--success)', label: 'Easy' },
  medium: { token: 'var(--warning)', label: 'Medium' },
  hard: { token: 'var(--danger)', label: 'Hard' },
};

export function DifficultyPill({ difficulty }: { difficulty: string }) {
  const style = STYLES[difficulty] ?? { token: 'var(--text-muted)', label: difficulty };

  return (
    <span
      className="rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ color: style.token, borderColor: style.token }}
    >
      {style.label}
    </span>
  );
}
