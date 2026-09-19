CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE FUNCTION derslik.actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid;
$$;
--> statement-breakpoint
CREATE FUNCTION derslik.workspace_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid;
$$;
--> statement-breakpoint
ALTER TABLE derslik.lessons ADD CONSTRAINT teacher_calendar_no_overlap
  EXCLUDE USING gist (workspace_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status <> 'CANCELLED');
--> statement-breakpoint
ALTER TABLE derslik.credit_entries ADD CONSTRAINT credit_reversal_same_workspace
  FOREIGN KEY (workspace_id, reverses_id) REFERENCES derslik.credit_entries (workspace_id, id);
--> statement-breakpoint
ALTER TABLE derslik.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.users FORCE ROW LEVEL SECURITY;
CREATE POLICY own_user ON derslik.users FOR ALL
  USING (id = derslik.actor_id()) WITH CHECK (id = derslik.actor_id());
--> statement-breakpoint
ALTER TABLE derslik.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY own_workspace ON derslik.workspaces FOR ALL
  USING (owner_id = derslik.actor_id()) WITH CHECK (owner_id = derslik.actor_id());
--> statement-breakpoint
ALTER TABLE derslik.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY own_membership ON derslik.memberships FOR SELECT USING (user_id = derslik.actor_id());
CREATE POLICY bootstrap_owner ON derslik.memberships FOR INSERT WITH CHECK (
  user_id = derslik.actor_id() AND role = 'OWNER' AND EXISTS (
    SELECT 1 FROM derslik.workspaces w WHERE w.id = workspace_id AND w.owner_id = derslik.actor_id()
  )
);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'students', 'packages', 'lessons', 'credit_entries', 'charges', 'payments',
    'payment_allocations', 'private_notes', 'api_commands', 'audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE derslik.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE derslik.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY owner_workspace ON derslik.%I FOR ALL USING (
         workspace_id = derslik.workspace_id() AND EXISTS (
           SELECT 1 FROM derslik.workspaces w WHERE w.id = workspace_id AND w.owner_id = derslik.actor_id()
         )
       ) WITH CHECK (
         workspace_id = derslik.workspace_id() AND EXISTS (
           SELECT 1 FROM derslik.workspaces w WHERE w.id = workspace_id AND w.owner_id = derslik.actor_id()
         )
       )', table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA derslik FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA derslik FROM PUBLIC;
GRANT USAGE ON SCHEMA derslik TO derslik_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA derslik TO derslik_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA derslik TO derslik_app;
REVOKE UPDATE ON derslik.credit_entries, derslik.audit_events, derslik.charges, derslik.payment_allocations FROM derslik_app;
REVOKE UPDATE ON derslik.memberships FROM derslik_app;
--> statement-breakpoint
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA derslik FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA derslik FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
