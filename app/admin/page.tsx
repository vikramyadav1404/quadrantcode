/** Admin landing. Real surfaces arrive with F1.1, F2.3 and F4.x. */
export default function AdminHome() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-2 text-[var(--text-muted)]">
        Problem CRUD (F1.1), job inspection (F2.3) and the abuse queue (F4.3) mount here.
      </p>
    </main>
  );
}
