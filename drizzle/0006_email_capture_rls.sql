-- Tenant isolation for email capture tables.
ALTER TABLE email_capture_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE email_capture_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON email_capture_tokens FOR ALL TO exato_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE email_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON email_messages FOR ALL TO exato_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
-- Inbound email arrives without a session. Resolve the per-user capture token
-- (by its SHA-256) to the owning tenant and user, only while that user is an
-- active member. Everything after runs under normal RLS.
CREATE OR REPLACE FUNCTION resolve_email_capture(p_hash text)
  RETURNS TABLE(tenant_id uuid, user_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT t.tenant_id, t.user_id FROM email_capture_tokens t
    JOIN tenant_memberships m ON m.tenant_id = t.tenant_id AND m.user_id = t.user_id
    WHERE t.token_hash = p_hash AND m.status = 'active'
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_email_capture(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_email_capture(text) TO exato_app;
