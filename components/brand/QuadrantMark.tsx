/** The Quadrantcode mark: four blocks, with the final quadrant moving forward. */
export function QuadrantMark() {
  return (
    <span aria-hidden="true" className="auth-brand-mark">
      <svg viewBox="0 0 32 32">
        <rect fill="currentColor" height="12" width="12" x="2" y="2" />
        <rect className="auth-brand-accent" height="12" width="12" x="18" y="2" />
        <rect fill="currentColor" height="12" width="12" x="2" y="18" />
        <rect fill="currentColor" height="12" width="12" x="18" y="18" />
      </svg>
    </span>
  );
}
