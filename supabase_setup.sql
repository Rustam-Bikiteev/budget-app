-- RETIRED: old setup granted every authenticated user access to every budget.
-- Fresh: supabase/migrations/001_households.sql.
-- Legacy: maintenance transaction in docs/ARCHITECTURE.md, explicit account UUIDs.
-- This file deliberately changes no grants, data or publications.
DO $$ BEGIN RAISE EXCEPTION 'retired_setup_use_versioned_migration'; END $$;
