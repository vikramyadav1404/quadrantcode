/** Single source of truth for navigation — sidebar and bottom nav share it. */
export type NavItem = { href: string; label: string; short: string; icon: string };

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', short: 'Home', icon: '◈' },
  { href: '/problems', label: 'Problems', short: 'Problems', icon: '☰' },
  { href: '/sessions', label: 'Sessions', short: 'Sessions', icon: '⏱' },
  { href: '/revision', label: 'Revision', short: 'Revision', icon: '↻' },
  { href: '/contests', label: 'Contests', short: 'Contests', icon: '⚑' },
  { href: '/analytics', label: 'Analytics', short: 'Stats', icon: '▤' },
  { href: '/settings', label: 'Settings', short: 'Settings', icon: '⚙' },
];

/** Bottom nav shows the five most-used destinations under 768px. */
export const BOTTOM_NAV_ITEMS = NAV_ITEMS.filter((item) =>
  ['/dashboard', '/problems', '/sessions', '/revision', '/analytics'].includes(item.href),
);
