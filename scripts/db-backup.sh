#!/usr/bin/env bash
# Dump the production database, prove the dump restores with every row, and
# leave only an encrypted copy behind. Run by .github/workflows/db-backup.yml;
# see docs/db-backup.md.
#
#   DB_URL             source database (direct, non-pooled connection)
#   RESTORE_URL        an empty throwaway database to restore into
#   PGBIN              directory holding pg_dump, pg_restore and psql whose
#                      major version matches the source server
#   BACKUP_PASSPHRASE  symmetric passphrase for the encrypted copy
#   OUT_DIR            where the .gpg file and its .sha256 are written
#
# The repository is public, so nothing read from the database is printed
# except table and row totals, and only the encrypted file reaches OUT_DIR.
set -euo pipefail

: "${DB_URL:?}" "${RESTORE_URL:?}" "${PGBIN:?}" "${BACKUP_PASSPHRASE:?}" "${OUT_DIR:?}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$OUT_DIR"

stamp="$(date -u +%Y-%m-%dT%H%MZ)"
name="quadrantcode-db-$stamp"
dump="$work/$name.dump"

# Exact row count for every ordinary table, one "schema.table<TAB>count" per line.
counts() {
  "$PGBIN/psql" "$1" -X -q -A -t -F $'\t' -v ON_ERROR_STOP=1 <<'SQL'
select format('%I.%I', n.nspname, c.relname),
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname),
                           false, true, '')))[1]::text::bigint
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg\_%'
order by 1;
SQL
}

echo "Counting rows before the dump"
counts "$DB_URL" > "$work/before.tsv"

echo "Dumping"
"$PGBIN/pg_dump" --format=custom --compress=9 --no-password --file="$dump" "$DB_URL"

echo "Counting rows after the dump"
counts "$DB_URL" > "$work/after.tsv"

"$PGBIN/pg_restore" --list "$dump" > "$work/toc.txt"
data_entries="$(grep -c ' TABLE DATA ' "$work/toc.txt" || true)"
if [ "$data_entries" -eq 0 ]; then
  echo "::error::the dump has no table data"
  exit 1
fi

echo "Restoring into the throwaway database"
"$PGBIN/pg_restore" --no-owner --no-acl --exit-on-error --single-transaction \
  --dbname="$RESTORE_URL" "$dump"
counts "$RESTORE_URL" > "$work/restored.tsv"

# Same tables on both sides, and each restored count equal to production's.
# A table written to while the dump ran may legitimately differ, but only
# within the range its before/after counts span.
cut -f1 "$work/before.tsv" > "$work/tables.before"
cut -f1 "$work/restored.tsv" > "$work/tables.restored"
if ! diff -q "$work/tables.before" "$work/tables.restored" > /dev/null; then
  echo "::error::the restored table list differs from production"
  diff "$work/tables.before" "$work/tables.restored" || true
  exit 1
fi

paste "$work/before.tsv" "$work/after.tsv" "$work/restored.tsv" | awk -F'\t' '
  {
    t = $1; b = $2 + 0; a = $4 + 0; r = $6 + 0
    if ($1 != $3 || $1 != $5) { print "::error::row order mismatch at " t; bad = 1; next }
    lo = (b < a) ? b : a; hi = (b < a) ? a : b
    if (r < lo || r > hi) { print "::error::" t " restored with a different row count"; bad = 1 }
    else if (b != a)      { print "::notice::" t " was written to during the dump" }
    tables++; rows += r
  }
  END {
    if (tables == 0) { print "::error::no tables found"; exit 1 }
    printf "Verified %d tables, %d rows restored\n", tables, rows
    exit bad
  }'

echo "Encrypting"
enc="$OUT_DIR/$name.dump.gpg"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 \
  --output "$enc" "$dump" 3<<< "$BACKUP_PASSPHRASE"

# Decrypt it back and compare, so a file that cannot be opened is never kept.
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --decrypt --output "$work/check.dump" "$enc" 3<<< "$BACKUP_PASSPHRASE"
cmp -s "$dump" "$work/check.dump" || { echo "::error::decrypted copy differs"; exit 1; }

(cd "$OUT_DIR" && sha256sum "$name.dump.gpg" > "$name.dump.gpg.sha256")
echo "name=$name" >> "${GITHUB_OUTPUT:-/dev/null}"
printf 'Encrypted backup %s (%s bytes)\n' "$name.dump.gpg" "$(stat -c %s "$enc")"
