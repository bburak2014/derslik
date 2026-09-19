CREATE TABLE derslik.subscriptions (
 workspace_id uuid PRIMARY KEY REFERENCES derslik.workspaces(id),billing_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 provider_id text UNIQUE,status text NOT NULL DEFAULT 'none',provider_updated_at timestamptz,
 ends_at timestamptz,renews_at timestamptz,checkout_url text,checkout_expires_at timestamptz,
 preparing_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE derslik.subscription_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES derslik.workspaces(id),
 hash text NOT NULL UNIQUE,provider_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE derslik.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE derslik.subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.subscription_events FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_subscriptions ON derslik.subscriptions FOR ALL USING(workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id)) WITH CHECK(workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id));
CREATE POLICY owner_subscription_events ON derslik.subscription_events FOR ALL USING(workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id)) WITH CHECK(workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id));
GRANT SELECT,INSERT,UPDATE ON derslik.subscriptions TO derslik_app;
GRANT SELECT,INSERT ON derslik.subscription_events TO derslik_app;
CREATE FUNCTION derslik.subscription_owner(key uuid,provider text) RETURNS TABLE(workspace_id uuid,owner_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT s.workspace_id,w.owner_id FROM derslik.subscriptions s JOIN derslik.workspaces w ON w.id=s.workspace_id
 WHERE s.billing_key=key OR (provider IS NOT NULL AND s.provider_id=provider);
$$;
REVOKE ALL ON FUNCTION derslik.subscription_owner(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.subscription_owner(uuid,text) TO derslik_app;
--> statement-breakpoint
CREATE FUNCTION derslik.expire_subscription(ws uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
BEGIN
 IF NOT derslik.has_workspace_access(ws) THEN RETURN; END IF;
 UPDATE derslik.workspace_limits SET plan='PILOT',student_limit=30,video_seconds=36000,material_bytes=209715200
 WHERE workspace_id=ws AND plan='PRO' AND EXISTS(SELECT 1 FROM derslik.subscriptions s WHERE s.workspace_id=ws AND s.status='cancelled' AND s.ends_at<=now());
END $$;
REVOKE ALL ON FUNCTION derslik.expire_subscription(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.expire_subscription(uuid) TO derslik_app;
