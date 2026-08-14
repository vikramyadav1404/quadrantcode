/** Admin landing. Problem CRUD arrived with F1.1; the rest is cut scope. */
export default function AdminHome() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-2 text-[var(--text-muted)]">
        Problem CRUD (F1.1) lives here. Job inspection (F2.3) and the abuse queue (F4.3) are cut
        from the target scope — see the README&rsquo;s roadmap table.
      </p>
    </main>
  );
}
