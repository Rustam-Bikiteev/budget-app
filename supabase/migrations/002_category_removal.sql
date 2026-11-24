BEGIN;

CREATE FUNCTION budget_private.move_removed_categories() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
DECLARE
  removed text[];
  target text;
BEGIN
  SELECT array_agg(old_cat->>'id') INTO removed
  FROM jsonb_array_elements(OLD.settings->'categories') AS old_cat
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.settings->'categories') AS new_cat
    WHERE new_cat->>'id' = old_cat->>'id'
  );
  IF removed IS NULL THEN RETURN NEW; END IF;

  SELECT category->>'id' INTO target
  FROM jsonb_array_elements(NEW.settings->'categories') WITH ORDINALITY AS c(category, position)
  ORDER BY coalesce((category->>'default')::boolean, false) DESC,
    CASE WHEN (category->>'default')::boolean THEN position ELSE -position END
  LIMIT 1;

  UPDATE public.entries SET category=target, revision=revision+1
    WHERE household_id=NEW.id AND category=ANY(removed);
  UPDATE public.backlog SET category=target, revision=revision+1
    WHERE household_id=NEW.id AND category=ANY(removed);
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION budget_private.move_removed_categories() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER budget_move_removed_categories
  AFTER UPDATE OF settings ON public.households
  FOR EACH ROW WHEN (OLD.settings IS DISTINCT FROM NEW.settings)
  EXECUTE FUNCTION budget_private.move_removed_categories();

CREATE FUNCTION budget_private.require_current_category() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.category IS NOT DISTINCT FROM OLD.category THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.households h
    CROSS JOIN LATERAL jsonb_array_elements(h.settings->'categories') AS c
    WHERE h.id = NEW.household_id AND c->>'id' = NEW.category
  ) THEN RAISE EXCEPTION 'revision_conflict' USING ERRCODE='40001';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION budget_private.require_current_category() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER budget_require_entry_category
  BEFORE INSERT OR UPDATE OF category ON public.entries
  FOR EACH ROW EXECUTE FUNCTION budget_private.require_current_category();
CREATE TRIGGER budget_require_backlog_category
  BEFORE INSERT OR UPDATE OF category ON public.backlog
  FOR EACH ROW EXECUTE FUNCTION budget_private.require_current_category();

COMMIT;
