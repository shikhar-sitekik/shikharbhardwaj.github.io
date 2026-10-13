-- Tenant isolation for integration tables (default privileges already grant DML to exato_app).
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE integration_connections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON integration_connections FOR ALL TO exato_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_events FOR ALL TO exato_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON integration_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- Inbound webhooks arrive without a session, so the tenant is unknown until the
-- connection is resolved. This narrowly scoped SECURITY DEFINER function
-- returns only the owning tenant of an enabled connection of a given provider;
-- all further work happens under normal RLS with that tenant set.
CREATE OR REPLACE FUNCTION resolve_inbound_connection(p_connection_id uuid, p_provider text)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT tenant_id FROM integration_connections
    WHERE id = p_connection_id AND provider = p_provider AND status <> 'disabled'
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_inbound_connection(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_inbound_connection(uuid, text) TO exato_app;
