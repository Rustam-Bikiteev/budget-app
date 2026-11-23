-- ADMIN ONLY, maintenance window, offline clients, verified external backup.
-- BEGIN; this file; migrations/001_households.sql; legacy/import.sql;
-- SELECT budget_private.import_legacy('explicit-owner-uuid','explicit-partner-uuid'); COMMIT;
-- Never infer UUIDs from auth.users or an email ordering.
DO $$
DECLARE t text; c record; allowed text[]; required text[]; n text;
BEGIN
  IF to_regnamespace('budget_legacy') IS NOT NULL OR to_regnamespace('budget_private') IS NOT NULL
    THEN RAISE EXCEPTION 'legacy_already_prepared'; END IF;
  FOREACH t IN ARRAY ARRAY['months','entries','backlog'] LOOP
    IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'legacy_missing_table: %',t; END IF;
    allowed:=CASE t WHEN 'months' THEN ARRAY['id','year','month','half','income','saved','transferred']
      WHEN 'entries' THEN ARRAY['id','month_id','type','category','name','planned','actual']
      ELSE ARRAY['id','category','name','planned'] END;
    required:=array_remove(allowed,'transferred');
    FOREACH n IN ARRAY required LOOP
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name=n)
        THEN RAISE EXCEPTION 'legacy_missing_column: %.%',t,n; END IF;
    END LOOP;
    FOR c IN SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=t LOOP
      IF NOT c.column_name=ANY(allowed) THEN RAISE EXCEPTION 'legacy_unknown_column: %.%',t,c.column_name; END IF;
      IF c.column_name IN ('id','month_id','year','month','half') AND c.data_type NOT IN ('integer','bigint')
        OR c.column_name IN ('income','saved','transferred','planned','actual') AND c.data_type NOT IN ('numeric','real')
        OR c.column_name IN ('type','category','name') AND c.data_type NOT IN ('text','character varying')
        THEN RAISE EXCEPTION 'legacy_incompatible_type: %.% %',t,c.column_name,c.data_type; END IF;
    END LOOP;
  END LOOP;
END $$;
CREATE SCHEMA budget_legacy;
REVOKE ALL ON SCHEMA budget_legacy FROM PUBLIC, anon, authenticated;
DO $$ DECLARE t text; p record; BEGIN
  FOREACH t IN ARRAY ARRAY['months','entries','backlog'] LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t);
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I',t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I SET SCHEMA budget_legacy',t);
  END LOOP;
END $$;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA budget_legacy FROM PUBLIC, anon, authenticated;

-- Production legacy used real. Convert only whole amounts in the exact integer range.
DO $$ DECLARE c record; unsupported boolean; BEGIN
  FOR c IN SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='budget_legacy' AND table_name IN ('months','entries','backlog')
      AND column_name IN ('income','saved','transferred','planned','actual') AND data_type='real'
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM budget_legacy.%I WHERE %I IS NOT NULL AND
      (%I NOT BETWEEN -16777216 AND 16777216 OR %I <> trunc(%I)))',
      c.table_name,c.column_name,c.column_name,c.column_name,c.column_name) INTO unsupported;
    IF unsupported THEN RAISE EXCEPTION 'legacy_unsupported_real_amount: %.%',c.table_name,c.column_name; END IF;
    EXECUTE format('ALTER TABLE budget_legacy.%I ALTER COLUMN %I TYPE numeric USING %I::integer::numeric',
      c.table_name,c.column_name,c.column_name);
  END LOOP;
END $$;
