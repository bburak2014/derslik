CREATE TABLE derslik.portal_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES derslik.workspaces(id),
 student_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES derslik.users(id), role text NOT NULL CHECK(role IN ('STUDENT','GUARDIAN')),
 permissions text[] NOT NULL DEFAULT ARRAY['lessons','assignments','videos','notes'], revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,student_id,user_id,role), FOREIGN KEY(workspace_id,student_id) REFERENCES derslik.students(workspace_id,id)
);
CREATE UNIQUE INDEX one_student_account ON derslik.portal_links(workspace_id,student_id) WHERE role='STUDENT' AND revoked_at IS NULL;
CREATE TABLE derslik.invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES derslik.workspaces(id), student_id uuid NOT NULL,
 email text NOT NULL, role text NOT NULL CHECK(role IN ('STUDENT','GUARDIAN')), permissions text[] NOT NULL,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, accepted_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,student_id) REFERENCES derslik.students(workspace_id,id)
);
CREATE TABLE derslik.assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,student_id uuid NOT NULL,
 title text NOT NULL,instructions text NOT NULL DEFAULT '',due_on date NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id,student_id),FOREIGN KEY(workspace_id,student_id) REFERENCES derslik.students(workspace_id,id)
);
CREATE TABLE derslik.submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,student_id uuid NOT NULL,assignment_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES derslik.users(id),body text NOT NULL DEFAULT '',feedback text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','REVIEWED')),version int NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,assignment_id),
 FOREIGN KEY(workspace_id,assignment_id,student_id) REFERENCES derslik.assignments(workspace_id,id,student_id)
);
CREATE TABLE derslik.shared_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,student_id uuid NOT NULL,body text NOT NULL,
 audience text NOT NULL CHECK(audience IN ('STUDENT','BOTH')),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,student_id) REFERENCES derslik.students(workspace_id,id)
);
CREATE TABLE derslik.materials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,student_id uuid NOT NULL,assignment_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES derslik.users(id),purpose text NOT NULL CHECK(purpose IN ('ASSIGNMENT','SUBMISSION')),
 name text NOT NULL,mime_type text NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes>0 AND size_bytes<=10485760),
 object_key text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','READY','DELETED')),
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,assignment_id,student_id) REFERENCES derslik.assignments(workspace_id,id,student_id)
);
CREATE TABLE derslik.videos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,student_id uuid NOT NULL,lesson_id uuid NOT NULL,
 title text NOT NULL,provider_uid text UNIQUE,upload_url text,upload_expires_at timestamptz,
 status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN ('RESERVED','UPLOADING','PROCESSING','READY','FAILED','DELETED')),
 reserved_seconds int NOT NULL CHECK(reserved_seconds>0 AND reserved_seconds<=7200),size_bytes bigint NOT NULL CHECK(size_bytes>0 AND size_bytes<=2147483648),
 duration_seconds int,delete_requested boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id,student_id),
 FOREIGN KEY(workspace_id,lesson_id,student_id) REFERENCES derslik.lessons(workspace_id,id,student_id)
);
CREATE TABLE derslik.video_questions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,student_id uuid NOT NULL,video_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES derslik.users(id),at_seconds int NOT NULL CHECK(at_seconds>=0),body text NOT NULL,
 answer text NOT NULL DEFAULT '',resolved boolean NOT NULL DEFAULT false,version int NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,video_id,student_id) REFERENCES derslik.videos(workspace_id,id,student_id)
);
CREATE TABLE derslik.video_progress (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,student_id uuid NOT NULL,video_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES derslik.users(id),seconds int NOT NULL CHECK(seconds>=0),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,video_id,user_id),FOREIGN KEY(workspace_id,video_id,student_id) REFERENCES derslik.videos(workspace_id,id,student_id)
);
CREATE TABLE derslik.weekly_summaries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,student_id uuid NOT NULL,week_on date NOT NULL,
 body text NOT NULL,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED')),version int NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,student_id,week_on),
 FOREIGN KEY(workspace_id,student_id) REFERENCES derslik.students(workspace_id,id)
);
CREATE TABLE derslik.notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES derslik.workspaces(id),user_id uuid NOT NULL REFERENCES derslik.users(id),
 title text NOT NULL,body text NOT NULL,student_id uuid,read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE derslik.workspace_limits (
 workspace_id uuid PRIMARY KEY REFERENCES derslik.workspaces(id),plan text NOT NULL DEFAULT 'PILOT',
 student_limit int NOT NULL DEFAULT 30 CHECK(student_limit>0),video_seconds int NOT NULL DEFAULT 36000 CHECK(video_seconds>=0),
 material_bytes bigint NOT NULL DEFAULT 209715200 CHECK(material_bytes>=0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE derslik.webhook_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES derslik.workspaces(id),
 event_hash text NOT NULL UNIQUE,provider_uid text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE derslik.lessons ADD COLUMN makeup_for_id uuid;
ALTER TABLE derslik.lessons ADD CONSTRAINT makeup_same_student FOREIGN KEY(workspace_id,makeup_for_id,student_id) REFERENCES derslik.lessons(workspace_id,id,student_id);
CREATE UNIQUE INDEX one_active_makeup ON derslik.lessons(workspace_id,makeup_for_id) WHERE makeup_for_id IS NOT NULL AND status<>'CANCELLED';
CREATE INDEX portal_user ON derslik.portal_links(user_id) WHERE revoked_at IS NULL;
CREATE INDEX assignments_student ON derslik.assignments(workspace_id,student_id,due_on);
CREATE INDEX video_student ON derslik.videos(workspace_id,student_id);
CREATE INDEX notifications_inbox ON derslik.notifications(user_id,created_at DESC);
--> statement-breakpoint
CREATE FUNCTION derslik.is_owner(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT EXISTS(SELECT 1 FROM derslik.workspaces w JOIN derslik.memberships m ON m.workspace_id=w.id
 WHERE w.id=ws AND w.owner_id=derslik.actor_id() AND m.user_id=derslik.actor_id() AND m.role='OWNER' AND m.active);
$$;
CREATE FUNCTION derslik.can_student(ws uuid,student uuid,permission text,write_access boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT derslik.is_owner(ws) OR EXISTS(SELECT 1 FROM derslik.portal_links p JOIN derslik.students s ON s.workspace_id=p.workspace_id AND s.id=p.student_id
 WHERE p.workspace_id=ws AND p.student_id=student AND p.user_id=derslik.actor_id() AND p.revoked_at IS NULL AND s.active
 AND permission=ANY(p.permissions) AND (NOT write_access OR p.role='STUDENT'));
$$;
CREATE FUNCTION derslik.has_workspace_access(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT derslik.is_owner(ws) OR EXISTS(SELECT 1 FROM derslik.portal_links p JOIN derslik.students s ON s.workspace_id=p.workspace_id AND s.id=p.student_id
 WHERE p.workspace_id=ws AND p.user_id=derslik.actor_id() AND p.revoked_at IS NULL AND s.active);
$$;
CREATE FUNCTION derslik.portal_role(ws uuid,student uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT role FROM derslik.portal_links WHERE workspace_id=ws AND student_id=student AND user_id=derslik.actor_id() AND revoked_at IS NULL ORDER BY role DESC LIMIT 1;
$$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['portal_links','invitations','assignments','submissions','shared_notes','materials','videos','video_questions','video_progress','weekly_summaries','workspace_limits','webhook_events'] LOOP
  EXECUTE format('ALTER TABLE derslik.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE derslik.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_all ON derslik.%I FOR ALL USING (workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id)) WITH CHECK (workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id))',t);
 END LOOP;
END $$;
CREATE POLICY own_portal_link ON derslik.portal_links FOR SELECT USING(user_id=derslik.actor_id() AND revoked_at IS NULL);
CREATE POLICY participant_workspace ON derslik.workspaces FOR SELECT USING(derslik.has_workspace_access(id));
CREATE POLICY portal_students ON derslik.students FOR SELECT USING(workspace_id=derslik.workspace_id() AND derslik.can_student(workspace_id,id,'lessons'));
CREATE POLICY portal_lessons ON derslik.lessons FOR SELECT USING(workspace_id=derslik.workspace_id() AND derslik.can_student(workspace_id,student_id,'lessons'));
CREATE POLICY portal_packages ON derslik.packages FOR SELECT USING(workspace_id=derslik.workspace_id() AND derslik.can_student(workspace_id,student_id,'payments'));
CREATE POLICY portal_payments ON derslik.payments FOR SELECT USING(workspace_id=derslik.workspace_id() AND derslik.can_student(workspace_id,student_id,'payments'));
CREATE POLICY portal_assignments ON derslik.assignments FOR SELECT USING(workspace_id=derslik.workspace_id() AND derslik.can_student(workspace_id,student_id,'assignments'));
CREATE POLICY portal_submissions_read ON derslik.submissions FOR SELECT USING(workspace_id=derslik.workspace_id() AND derslik.can_student(workspace_id,student_id,'assignments'));
CREATE POLICY portal_submissions_insert ON derslik.submissions FOR INSERT WITH CHECK(workspace_id=derslik.workspace_id() AND user_id=derslik.actor_id() AND derslik.can_student(workspace_id,student_id,'assignments',true));
CREATE POLICY portal_submissions_update ON derslik.submissions FOR UPDATE USING(workspace_id=derslik.workspace_id() AND user_id=derslik.actor_id() AND derslik.can_student(workspace_id,student_id,'assignments',true)) WITH CHECK(workspace_id=derslik.workspace_id() AND user_id=derslik.actor_id() AND derslik.can_student(workspace_id,student_id,'assignments',true));
CREATE POLICY portal_notes ON derslik.shared_notes FOR SELECT USING(workspace_id=derslik.workspace_id() AND derslik.can_student(workspace_id,student_id,'notes') AND (audience='BOTH' OR derslik.portal_role(workspace_id,student_id)='STUDENT'));
CREATE POLICY portal_materials_read ON derslik.materials FOR SELECT USING(workspace_id=derslik.workspace_id() AND derslik.can_student(workspace_id,student_id,'assignments'));
CREATE POLICY portal_materials_write ON derslik.materials FOR ALL USING(workspace_id=derslik.workspace_id() AND user_id=derslik.actor_id() AND purpose='SUBMISSION' AND derslik.can_student(workspace_id,student_id,'assignments',true)) WITH CHECK(workspace_id=derslik.workspace_id() AND user_id=derslik.actor_id() AND purpose='SUBMISSION' AND derslik.can_student(workspace_id,student_id,'assignments',true));
CREATE POLICY portal_videos ON derslik.videos FOR SELECT USING(workspace_id=derslik.workspace_id() AND derslik.can_student(workspace_id,student_id,'videos') AND status='READY' AND NOT delete_requested);
CREATE POLICY portal_questions_read ON derslik.video_questions FOR SELECT USING(workspace_id=derslik.workspace_id() AND derslik.can_student(workspace_id,student_id,'videos'));
CREATE POLICY portal_questions_insert ON derslik.video_questions FOR INSERT WITH CHECK(workspace_id=derslik.workspace_id() AND user_id=derslik.actor_id() AND derslik.can_student(workspace_id,student_id,'videos',true));
CREATE POLICY portal_progress ON derslik.video_progress FOR ALL USING(workspace_id=derslik.workspace_id() AND user_id=derslik.actor_id() AND derslik.can_student(workspace_id,student_id,'videos')) WITH CHECK(workspace_id=derslik.workspace_id() AND user_id=derslik.actor_id() AND derslik.can_student(workspace_id,student_id,'videos'));
CREATE POLICY portal_summary ON derslik.weekly_summaries FOR SELECT USING(workspace_id=derslik.workspace_id() AND status='PUBLISHED' AND derslik.can_student(workspace_id,student_id,'notes'));
CREATE POLICY portal_commands ON derslik.api_commands FOR ALL USING(workspace_id=derslik.workspace_id() AND actor_id=derslik.actor_id() AND derslik.has_workspace_access(workspace_id)) WITH CHECK(workspace_id=derslik.workspace_id() AND actor_id=derslik.actor_id() AND derslik.has_workspace_access(workspace_id));
CREATE POLICY portal_audit_insert ON derslik.audit_events FOR INSERT WITH CHECK(workspace_id=derslik.workspace_id() AND actor_id=derslik.actor_id() AND derslik.has_workspace_access(workspace_id));
ALTER TABLE derslik.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY own_notifications ON derslik.notifications FOR SELECT USING(user_id=derslik.actor_id());
CREATE POLICY read_notifications ON derslik.notifications FOR UPDATE USING(user_id=derslik.actor_id()) WITH CHECK(user_id=derslik.actor_id());
CREATE POLICY notify_participants ON derslik.notifications FOR INSERT WITH CHECK(workspace_id=derslik.workspace_id() AND (derslik.is_owner(workspace_id) OR (derslik.has_workspace_access(workspace_id) AND user_id=(SELECT owner_id FROM derslik.workspaces WHERE id=workspace_id))));
--> statement-breakpoint
CREATE FUNCTION derslik.accept_invitation(invite_hash text,verified_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE inv derslik.invitations; link_id uuid; BEGIN
 SELECT * INTO inv FROM derslik.invitations WHERE token_hash=invite_hash FOR UPDATE;
 IF inv.id IS NULL OR inv.email<>lower(verified_email) OR inv.expires_at<now() OR inv.revoked_at IS NOT NULL OR inv.accepted_at IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM derslik.students WHERE id=inv.student_id AND workspace_id=inv.workspace_id AND active) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='23514'; END IF;
 INSERT INTO derslik.users(id) VALUES(derslik.actor_id()) ON CONFLICT DO NOTHING;
 INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions) VALUES(inv.workspace_id,inv.student_id,derslik.actor_id(),inv.role,inv.permissions)
 ON CONFLICT(workspace_id,student_id,user_id,role) DO UPDATE SET permissions=EXCLUDED.permissions,revoked_at=NULL RETURNING id INTO link_id;
 INSERT INTO derslik.memberships(workspace_id,user_id,role) VALUES(inv.workspace_id,derslik.actor_id(),inv.role) ON CONFLICT(workspace_id,user_id,role) DO UPDATE SET active=true;
 UPDATE derslik.invitations SET accepted_at=now() WHERE id=inv.id;
 RETURN jsonb_build_object('id',link_id,'workspaceId',inv.workspace_id,'studentId',inv.student_id,'role',inv.role);
END $$;
CREATE FUNCTION derslik.video_owner(uid text) RETURNS TABLE(workspace_id uuid,owner_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT v.workspace_id,w.owner_id FROM derslik.videos v JOIN derslik.workspaces w ON w.id=v.workspace_id WHERE v.provider_uid=uid;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA derslik FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA derslik TO derslik_app;
GRANT SELECT,INSERT,UPDATE ON derslik.portal_links,derslik.invitations,derslik.assignments,derslik.submissions,derslik.shared_notes,derslik.materials,derslik.videos,derslik.video_questions,derslik.video_progress,derslik.weekly_summaries,derslik.notifications,derslik.workspace_limits,derslik.webhook_events TO derslik_app;
REVOKE UPDATE ON derslik.webhook_events FROM derslik_app;

--> statement-breakpoint
CREATE FUNCTION derslik.reserve_material_quota(ws uuid,student uuid,bytes bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE maximum bigint; used bigint;
BEGIN
 IF bytes<1 OR bytes>10485760 OR NOT derslik.can_student(ws,student,'assignments',true) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 INSERT INTO derslik.workspace_limits(workspace_id) VALUES(ws) ON CONFLICT DO NOTHING;
 SELECT material_bytes INTO maximum FROM derslik.workspace_limits WHERE workspace_id=ws FOR UPDATE;
 SELECT COALESCE(sum(size_bytes),0) INTO used FROM derslik.materials WHERE workspace_id=ws AND status<>'DELETED';
 IF used+bytes>maximum THEN RAISE EXCEPTION 'File storage quota exceeded' USING ERRCODE='23514'; END IF;
END $$;
REVOKE ALL ON FUNCTION derslik.reserve_material_quota(uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.reserve_material_quota(uuid,uuid,bigint) TO derslik_app;
