-- Installed by the migration administrator, never exposed to PostgREST roles.
CREATE FUNCTION budget_private.import_legacy(owner_id uuid, partner_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $$ DECLARE h uuid; t text; next_id bigint; BEGIN
  IF owner_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=$1)
    OR ($2 IS NOT NULL AND ($2=$1 OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=$2)))
    THEN RAISE EXCEPTION 'explicit_valid_users_required'; END IF;
  IF to_regclass('budget_legacy.months') IS NULL THEN RAISE EXCEPTION 'legacy_not_prepared'; END IF;
  LOCK TABLE budget_legacy.months,budget_legacy.entries,budget_legacy.backlog IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.months) OR EXISTS (SELECT 1 FROM public.entries) OR EXISTS (SELECT 1 FROM public.backlog)
    OR EXISTS (SELECT 1 FROM public.households) THEN RAISE EXCEPTION 'import_requires_empty_target'; END IF;
  INSERT INTO public.households(name,settings) VALUES ('Семейный бюджет',jsonb_build_object('categories',
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',category,'name',category,'color','#8b80c9','default',false) ORDER BY category)
      FROM (SELECT category FROM budget_legacy.entries UNION SELECT category FROM budget_legacy.backlog) c),
      '[{"id":"general","name":"Общие","color":"#8b80c9","default":true}]'::jsonb))) RETURNING id INTO h;
  INSERT INTO public.household_members VALUES (h,$1,'owner');
  IF $2 IS NOT NULL THEN INSERT INTO public.household_members VALUES (h,$2,'member'); END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='budget_legacy' AND table_name='months' AND column_name='transferred') THEN
    ALTER TABLE budget_legacy.months ADD COLUMN transferred numeric;
  END IF;
  INSERT INTO public.months(id,household_id,year,month,half,income,saved,transferred)
    SELECT id,h,year,month,half,coalesce(income,0),coalesce(saved,0),transferred FROM budget_legacy.months;
  INSERT INTO public.entries(id,household_id,month_id,type,category,name,planned,actual,is_reserve)
    SELECT id,h,month_id,type,category,coalesce(name,''),coalesce(planned,0),coalesce(actual,0),
      type='mandatory' AND lower(coalesce(name,'')) LIKE '%непредвид%' FROM budget_legacy.entries;
  INSERT INTO public.backlog(id,household_id,category,name,planned)
    SELECT id,h,category,coalesce(name,''),coalesce(planned,0) FROM budget_legacy.backlog;
  FOREACH t IN ARRAY ARRAY['months','entries','backlog'] LOOP
    EXECUTE format('SELECT coalesce(max(id),0)+1 FROM public.%I',t) INTO next_id;
    PERFORM setval(pg_get_serial_sequence('public.'||t,'id'),greatest(next_id,1),false);
  END LOOP;
  RETURN h;
END $$;
REVOKE ALL ON FUNCTION budget_private.import_legacy(uuid,uuid) FROM PUBLIC, anon, authenticated;
