-- Platform security layer: application role, row-level security, search indexes.
--
-- The application connects as `exato_app` (no BYPASSRLS, not table owner), so
-- every policy below is enforced. Migrations run as the owner role.
-- The role is created NOLOGIN; operators enable login out-of-band:
--   ALTER ROLE exato_app WITH LOGIN PASSWORD '<secret>';
-- (On Supabase, do this in the SQL editor; never commit the password.)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'exato_app') THEN
    CREATE ROLE exato_app NOLOGIN NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO exato_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO exato_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO exato_app;
--> statement-breakpoint
-- Audit log is append-only for the application.
REVOKE UPDATE, DELETE ON audit_logs FROM exato_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  -- Tenant-owned tables: strict tenant isolation.
  FOREACH t IN ARRAY ARRAY[
    'teams','roles','tenant_memberships','territories','lead_statuses','leads','accounts',
    'contacts','pipelines','pipeline_stages','opportunities','opportunity_stage_history',
    'opportunity_contacts','activities','audit_logs','outbox_events','import_jobs',
    'import_rows','notifications','recent_views','custom_field_definitions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO exato_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t
    );
  END LOOP;

  -- Global tables accessed only through server-side auth/job code. RLS is
  -- enabled so that any other role (e.g. Supabase anon/authenticated via the
  -- Data API) gets no rows; the app role has an explicit allow policy.
  FOREACH t IN ARRAY ARRAY['users','sessions','login_attempts','jobs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY app_access ON %I FOR ALL TO exato_app USING (true) WITH CHECK (true)', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['tenants','users','roles','leads','accounts','contacts','opportunities','activities']
  LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END
$$;
--> statement-breakpoint
-- A user can see their own memberships across tenants (workspace switcher).
CREATE POLICY own_memberships ON tenant_memberships FOR SELECT TO exato_app
  USING (user_id = app_user_id());
--> statement-breakpoint
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_self ON tenants FOR ALL TO exato_app
  USING (id = app_tenant_id())
  WITH CHECK (id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY tenant_member_read ON tenants FOR SELECT TO exato_app
  USING (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = tenants.id AND m.user_id = app_user_id() AND m.status = 'active'));
--> statement-breakpoint
CREATE INDEX leads_search_trgm ON leads USING gin ((coalesce(first_name,'') || ' ' || last_name || ' ' || coalesce(company,'') || ' ' || coalesce(email,'')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX accounts_search_trgm ON accounts USING gin ((name || ' ' || coalesce(domain,'')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX contacts_search_trgm ON contacts USING gin ((coalesce(first_name,'') || ' ' || last_name || ' ' || coalesce(email,'')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX opportunities_search_trgm ON opportunities USING gin (name gin_trgm_ops);
