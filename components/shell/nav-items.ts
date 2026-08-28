/** Single source of truth for navigation — sidebar and bottom nav share it. */
export type NavItem = { href: string; label: string; short: string; icon: string };

/**
 * `/contests` is deliberately absent.
 *
 * It was here from F0.4, pointing at F2.5 (`contest-upsolve`) — which is **cut**
 * (D17's scope decision). Its page was never going to be built, so the link was
 * a permanent 404 in the primary navigation of every authenticated page.
 *
 * Removed rather than stubbed. A "coming soon" page for a feature that is not
 * coming is the dead-end-that-looks-handled this project has refused before; an
 * absent link tells the truth with less code. It goes back if F2.5 does.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', short: 'Home', icon: '◈' },
  { href: '/problems', label: 'Problems', short: 'Problems', icon: '☰' },
  { href: '/sessions', label: 'Sessions', short: 'Sessions', icon: '⏱' },
  { href: '/revision', label: 'Revision', short: 'Revision', icon: '↻' },
  { href: '/analytics', label: 'Analytics', short: 'Stats', icon: '▤' },
  { href: '/settings', label: 'Settings', short: 'Settings', icon: '⚙' },
];

/** Bottom nav shows the five most-used destinations under 768px. */
export const BOTTOM_NAV_ITEMS = NAV_ITEMS.filter((item) =>
  ['/dashboard', '/problems', '/sessions', '/revision', '/analytics'].includes(item.href),
);
