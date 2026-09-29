#!/usr/bin/env bash
set -euo pipefail
# Use a disposable database ONLY: bootstrap creates mock auth schema and roles.
: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to a disposable PostgreSQL 15+ database}"
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database.sql
