'use client';

/**
 * Generic, cursor-paginated, sortable table.
 *
 * F0.4 requirement: "DataTable takes columns and a fetchPage callback — it must
 * not know about any domain entity." There is deliberately no `Problem`,
 * `Session` or any other domain type in this file. Callers supply the row type,
 * the columns and a function that fetches a page; the table owns nothing but
 * presentation, sort state and the cursor.
 *
 * Cursor pagination only — no OFFSET, so pages stay stable while rows are
 * inserted underneath (F1.1 depends on this).
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Skeleton } from './Skeleton';
import { EmptyState } from './EmptyState';

export type SortDirection = 'asc' | 'desc';

export type Column<Row> = {
  /** Stable key; also the sort key sent to `fetchPage`. */
  id: string;
  header: string;
  /** Render one cell. Returning a string is fine; it is escaped as a text node. */
  cell: (row: Row) => React.ReactNode;
  sortable?: boolean;
  /** Right-align numeric columns. */
  align?: 'start' | 'end';
  width?: string;
};

export type Page<Row> = {
  rows: Row[];
  /** Opaque cursor for the next page, or null when exhausted. */
  nextCursor: string | null;
};

export type FetchPage<Row> = (params: {
  cursor: string | null;
  sort: { id: string; direction: SortDirection } | null;
  signal: AbortSignal;
}) => Promise<Page<Row>>;

export type DataTableProps<Row> = {
  columns: Array<Column<Row>>;
  fetchPage: FetchPage<Row>;
  rowKey: (row: Row) => string;
  caption: string;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Re-fetches from the first page when this value changes (filter changes). */
  resetToken?: string;
};

export function DataTable<Row>({
  columns,
  fetchPage,
  rowKey,
  caption,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  resetToken = '',
}: DataTableProps<Row>) {
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [sort, setSort] = useState<{ id: string; direction: SortDirection } | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'loadingMore' | 'error'>('loading');

  const captionId = useId();
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (from: string | null, mode: 'replace' | 'append') => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setStatus(mode === 'replace' ? 'loading' : 'loadingMore');
      try {
        const page = await fetchPage({ cursor: from, sort, signal: controller.signal });
        setRows((previous) => (mode === 'replace' ? page.rows : [...previous, ...page.rows]));
        setCursor(page.nextCursor);
        setStatus('idle');
      } catch (error) {
        if (controller.signal.aborted) return; // superseded, not a failure
        setStatus('error');
        throw error;
      }
    },
    [fetchPage, sort],
  );

  useEffect(() => {
    void load(null, 'replace').catch(() => {
      /* status already set to 'error'; the boundary shows the message */
    });
    return () => controllerRef.current?.abort();
  }, [load, resetToken]);

  function toggleSort(columnId: string) {
    setSort((current) =>
      current?.id === columnId
        ? { id: columnId, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { id: columnId, direction: 'asc' },
    );
  }

  if (status === 'loading') return <TableSkeleton columns={columns.length} />;

  if (status === 'error') {
    return (
      <EmptyState
        title="Couldn't load this list"
        description="Something went wrong fetching these rows."
        action={{ label: 'Try again', onClick: () => void load(null, 'replace') }}
      />
    );
  }

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
        <table className="w-full border-collapse text-sm" aria-describedby={captionId}>
          <caption className="sr-only" id={captionId}>
            {caption}
          </caption>
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)]">
              {columns.map((column) => {
                const active = sort?.id === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    className={`px-3 py-2 font-medium ${
                      column.align === 'end' ? 'text-right' : 'text-left'
                    }`}
                    aria-sort={
                      active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded underline-offset-2 hover:underline"
                        onClick={() => toggleSort(column.id)}
                      >
                        {column.header}
                        <span aria-hidden="true">
                          {active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-[var(--border)] last:border-0">
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={`px-3 py-2 ${column.align === 'end' ? 'text-right' : 'text-left'}`}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cursor === null ? null : (
        <button
          type="button"
          className="self-start rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
          disabled={status === 'loadingMore'}
          onClick={() => void load(cursor, 'append')}
        >
          {status === 'loadingMore' ? 'Loading…' : 'Load more'}
        </button>
      )}

      <p aria-live="polite" className="sr-only">
        {`${rows.length} rows loaded`}
      </p>
    </div>
  );
}

export function TableSkeleton({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex gap-3 border-b border-[var(--border)] px-3 py-3 last:border-0"
        >
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Skeleton key={columnIndex} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
