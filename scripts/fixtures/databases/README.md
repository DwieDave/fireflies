# The Databases window's recorded client output

- `psql-*`: recorded from a throwaway PostgreSQL 17.10 (initdb in a temp folder,
  a Unix socket only) seeded by `pg-seed.sql`, running `psql-run.sql` and
  `psql-catalog.sql` with the arguments clients.ts gives psql. The fixture's
  markers are `__FF__` (counted from 1); the tests read them as script.ts's.
- `mysql-*`: written by hand in the format `mysql --xml --batch` prints (no
  MySQL or MariaDB server was at hand); checked against a real server: not yet.
