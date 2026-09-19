#!/bin/sh
set -eu

# Runs only when the database volume is first initialized.
# psql's quoted variable syntax safely handles the password as a SQL literal.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=app_password="$API_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE derslik_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'app_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
