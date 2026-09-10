-- Migration: Fix PostgREST HTTP 401 on unauthenticated / initializing queries
-- In PostgreSQL, PostgREST requires table-level SELECT privilege for the `anon` role
-- to pass queries through the Row Level Security (RLS) engine.
-- With RLS enabled on all tables, `anon` receives 0 rows (status 200 OK, empty array)
-- rather than triggering SQL error 42501 (permission denied) / HTTP 401 Unauthorized.

-- 1. Grant usage on schema public
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 2. Grant SELECT privileges on public tables to anon
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- 3. Ensure future tables also grant SELECT to anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
