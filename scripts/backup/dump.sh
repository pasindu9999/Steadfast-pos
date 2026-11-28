#!/usr/bin/env bash
# Writes an encrypted dump of one Postgres database (ARCH §8.1). To read it back: docs/RESTORE.md.
#
#   BACKUP_DATABASE_URL  a direct (not pooled) connection string
#   AGE_PUBLIC_KEY       the age recipient; only the matching private key can read the file
#   $1                   the file to write, ending in .sql.gz.age
#
# Needs bash, Docker, gzip and age.
set -euo pipefail
# Nothing written here is readable by another user.
umask 077

output=${1:?usage: dump.sh <output file>}
: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL}"
: "${AGE_PUBLIC_KEY:?set AGE_PUBLIC_KEY}"

# The unencrypted dump lives only here, and only until the script ends, however it ends.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Runs a command in the official image. The connection string goes in through the environment, so
# neither Docker's command line nor this script's output holds it.
in_postgres() {
  docker run --rm --env BACKUP_DATABASE_URL "$1" sh -c "$2"
}

# `pg_dump` must be at least as new as the server, so use the server's own major version.
# shellcheck disable=SC2016 # the variable is expanded inside the container
version=$(in_postgres postgres:17-alpine \
  'psql "$BACKUP_DATABASE_URL" --no-psqlrc -Atc "SHOW server_version_num"')
major=$((version / 10000))
echo "Dumping PostgreSQL $major"

# shellcheck disable=SC2016
in_postgres "postgres:$major-alpine" \
  'pg_dump "$BACKUP_DATABASE_URL" --no-owner --no-privileges' >"$work/dump.sql"

# `pg_dump` ends a whole dump with this comment.
if ! grep -q 'PostgreSQL database dump complete' "$work/dump.sql"; then
  echo 'The dump is incomplete' >&2
  exit 1
fi

gzip -9 "$work/dump.sql"
age --encrypt --recipient "$AGE_PUBLIC_KEY" --output "$output" "$work/dump.sql.gz"
echo "Wrote $(wc -c <"$output") encrypted bytes"
