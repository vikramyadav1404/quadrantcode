'use client';

/**
 * A pending mark for the link that was just clicked (issue #30).
 *
 * D39 removed every `loading.tsx` under `(app)`: a Suspense boundary above the
 * timer bar lets Next 15.5 drop server-action renders (vercel/next.js#87529).
 * The cost was feedback. Navigating to a problem, the dashboard or the catalog
 * keeps the previous screen until the next one has rendered, with nothing to
 * say a click registered.
 *
 * `useLinkStatus` reports whether the enclosing `<Link>`'s navigation is in
 * flight, without a Suspense boundary, so D39 still holds. Render this as a
 * child of the `<Link>` it describes. It must sit inside one.
 *
 * Renders nothing while idle, so the link's layout and accessible name are
 * unchanged at rest. While pending it adds a small spinner, which is decorative
 * (`aria-hidden`): the browser already tells assistive technology a navigation
 * is happening, and adding text would change the link's name mid-click.
 */
import { useLinkStatus } from 'next/link';

export function LinkPending({
  placement = 'ml-1.5 inline-block align-[-0.125em]',
}: {
  /**
   * Where the mark sits. Inline after the text by default; a stacked layout
   * (the mobile bottom nav) positions it absolutely so the row does not grow.
   */
  placement?: string;
}) {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      aria-hidden="true"
      className={`${placement} h-3 w-3 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] motion-safe:animate-spin`}
      data-testid="link-pending"
    />
  );
}
