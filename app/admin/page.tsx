import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';

const sections = [
  {
    href: '/admin/content-transfer',
    title: 'Import and export',
    description: 'Validated JSON/CSV transfer and restricted sensitive export.',
  },
  {
    href: '/admin/audit',
    title: 'Audit log',
    description: 'Immutable history of administrative mutations.',
  },
  {
    href: '/admin/papers',
    title: 'Paper builder',
    description: 'Original mock composition, marks, review, and publishing.',
  },
  {
    href: '/admin/companies',
    title: 'Companies and evidence',
    description: 'Company pages, evidence labels, sources, and verification.',
  },
  {
    href: '/admin/problems',
    title: 'Problems',
    description: 'Catalog and native-content workflow.',
  },
  {
    href: '/admin/interview-reports',
    title: 'Interview reports',
    description: 'Originality, NDA safety, evidence, and publishing moderation.',
  },
  {
    href: '/admin/health',
    title: 'System health',
    description: 'Dependencies, execution state, and operational signals.',
  },
];

export default function AdminHome() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        description="Server-authorized content, evidence, moderation, and operations controls."
        title="Admin"
      />
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <Link
            className="rounded-[var(--radius-lg)] border border-[var(--border)] p-5 hover:border-[var(--accent)]"
            href={section.href}
            key={section.href}
          >
            <h2 className="font-semibold">{section.title}</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{section.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
