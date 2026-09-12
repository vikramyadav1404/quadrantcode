/**
 * Avatar with a deterministic initials fallback.
 *
 * Presentation only — the appearance is computed server-side by
 * `avatarAppearance()` and passed in, so the same user renders the same colour
 * everywhere without the client re-deriving it.
 */
export type AvatarAppearanceProps = {
  initials: string;
  backgroundColor: string;
  color: string;
};

export function Avatar({
  src,
  appearance,
  size = 32,
  alt,
}: {
  src: string | null;
  appearance: AvatarAppearanceProps;
  size?: number;
  /** Empty when the avatar sits next to the name it would repeat. */
  alt?: string;
}) {
  const dimension = { width: size, height: size };

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatars come from a storage origin whose host is env-dependent; next/image would need it in remotePatterns at build time
      <img
        alt={alt ?? ''}
        className="rounded-full object-cover"
        height={size}
        src={src}
        style={dimension}
        width={size}
      />
    );
  }

  return (
    <span
      aria-hidden={alt ? undefined : 'true'}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium select-none"
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      style={{
        ...dimension,
        backgroundColor: appearance.backgroundColor,
        color: appearance.color,
        fontSize: Math.max(10, Math.round(size * 0.4)),
      }}
    >
      {appearance.initials}
    </span>
  );
}
