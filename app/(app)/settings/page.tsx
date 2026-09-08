/**
 * Settings index.
 *
 * The sidebar has linked to `/settings` since F0.4 and it has been a 404 the
 * whole time — every settings page is a direct-URL orphan. F3.2b adds a fifth
 * (`privacy`), which made the omission worth the twenty lines to close rather
 * than worth carrying further.
 *
 * Deliberately a list of links and nothing else. This is not a feature; it is
 * the door the nav already claimed existed.
 */
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';

const SECTIONS: { href: string; title: string; description: string }[] = [
  {
    href: '/settings/profile',
    title: 'Profile',
    description: 'Your name, bio, avatar and timezone.',
  },
  {
    href: '/settings/goals',
    title: 'Daily goal',
    description: 'How many problems a day, and your activity heatmap.',
  },
  {
    href: '/settings/privacy',
    title: 'Privacy',
    description: 'What is recorded while you solve, and how to erase it.',
  },
  {
    href: '/settings/account',
    title: 'Account',
    description: 'How you sign in — email, GitHub and phone.',
  },
  {
    href: '/settings/phone',
    title: 'Phone',
    description: 'Verify a phone number for a higher trust tier.',
  },
  {
    href: '/settings/import',
    title: 'Import & export',
    description: 'Bring in a CSV of solved problems, or take yours out.',
  },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader description="Everything you can change." title="Settings" />

      <ul aria-label="Settings sections" className="flex flex-col gap-2">
        {SECTIONS.map((section) => (
          <li
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
            key={section.href}
          >
            <Link className="font-medium underline" href={section.href}>
              {section.title}
            </Link>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">{section.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
