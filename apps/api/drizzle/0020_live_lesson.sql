-- Ders başına güvenli görüntülü görüşme bağlantısı ve kalıcı ortak tahta.
ALTER TABLE derslik.lessons ADD COLUMN meeting_url text
 CHECK(meeting_url IS NULL OR (char_length(meeting_url)<=2048 AND meeting_url ~* '^https://(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|meet\.jit\.si|([a-z0-9-]+\.)*zoom\.us)/[^[:space:]]+$'));
--> statement-breakpoint
CREATE FUNCTION derslik.can_lesson_board(ws uuid,student uuid,lesson uuid,write_access boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT derslik.can_student(ws,student,'lessons',write_access) AND EXISTS(
  SELECT 1 FROM derslik.lessons l JOIN derslik.students s ON s.workspace_id=l.workspace_id AND s.id=l.student_id
  WHERE l.workspace_id=ws AND l.student_id=student AND l.id=lesson AND l.status<>'CANCELLED'
   AND (NOT write_access OR (l.status='SCHEDULED' AND s.active))
 );
$$;
REVOKE ALL ON FUNCTION derslik.can_lesson_board(uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.can_lesson_board(uuid,uuid,uuid,boolean) TO derslik_app;
--> statement-breakpoint
CREATE TABLE derslik.lesson_boards (
 workspace_id uuid NOT NULL,
 student_id uuid NOT NULL,
 lesson_id uuid NOT NULL,
 epoch integer NOT NULL DEFAULT 0 CONSTRAINT lesson_board_epoch CHECK(epoch>=0),
 revision integer NOT NULL DEFAULT 0 CONSTRAINT lesson_board_revision CHECK(revision>=0),
 PRIMARY KEY(workspace_id,lesson_id),
 CONSTRAINT lesson_boards_scope UNIQUE(workspace_id,student_id,lesson_id),
 CONSTRAINT lesson_board_lesson_fk FOREIGN KEY(workspace_id,lesson_id,student_id) REFERENCES derslik.lessons(workspace_id,id,student_id)
);
CREATE TABLE derslik.lesson_board_strokes (
 workspace_id uuid NOT NULL,
 student_id uuid NOT NULL,
 lesson_id uuid NOT NULL,
 epoch integer NOT NULL CONSTRAINT lesson_stroke_epoch CHECK(epoch>=0),
 id uuid NOT NULL,
 author_id uuid NOT NULL CONSTRAINT lesson_stroke_author_fk REFERENCES derslik.users(id),
 points jsonb NOT NULL CONSTRAINT lesson_stroke_points CHECK(jsonb_typeof(points)='array' AND jsonb_array_length(points) BETWEEN 1 AND 128),
 color text NOT NULL CONSTRAINT lesson_stroke_color CHECK(color IN ('#172554','#2563eb','#dc2626','#16a34a')),
 width integer NOT NULL CONSTRAINT lesson_stroke_width CHECK(width IN (2,4,8)),
 removed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,lesson_id,epoch,id),
 CONSTRAINT lesson_stroke_board_fk FOREIGN KEY(workspace_id,student_id,lesson_id) REFERENCES derslik.lesson_boards(workspace_id,student_id,lesson_id)
);
ALTER TABLE derslik.lesson_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.lesson_boards FORCE ROW LEVEL SECURITY;
ALTER TABLE derslik.lesson_board_strokes ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.lesson_board_strokes FORCE ROW LEVEL SECURITY;
CREATE POLICY lesson_board_read ON derslik.lesson_boards FOR SELECT
 USING(workspace_id=derslik.workspace_id() AND derslik.can_lesson_board(workspace_id,student_id,lesson_id));
CREATE POLICY lesson_board_insert ON derslik.lesson_boards FOR INSERT
 WITH CHECK(workspace_id=derslik.workspace_id() AND derslik.can_lesson_board(workspace_id,student_id,lesson_id,true));
CREATE POLICY lesson_board_update ON derslik.lesson_boards FOR UPDATE
 USING(workspace_id=derslik.workspace_id() AND derslik.can_lesson_board(workspace_id,student_id,lesson_id,true))
 WITH CHECK(workspace_id=derslik.workspace_id() AND derslik.can_lesson_board(workspace_id,student_id,lesson_id,true));
CREATE POLICY lesson_stroke_read ON derslik.lesson_board_strokes FOR SELECT
 USING(workspace_id=derslik.workspace_id() AND derslik.can_lesson_board(workspace_id,student_id,lesson_id));
CREATE POLICY lesson_stroke_insert ON derslik.lesson_board_strokes FOR INSERT
 WITH CHECK(workspace_id=derslik.workspace_id() AND author_id=derslik.actor_id() AND derslik.can_lesson_board(workspace_id,student_id,lesson_id,true)
  AND EXISTS(SELECT 1 FROM derslik.lesson_boards b WHERE b.workspace_id=lesson_board_strokes.workspace_id AND b.lesson_id=lesson_board_strokes.lesson_id AND b.epoch=lesson_board_strokes.epoch));
CREATE POLICY lesson_stroke_update ON derslik.lesson_board_strokes FOR UPDATE
 USING(workspace_id=derslik.workspace_id() AND (author_id=derslik.actor_id() OR derslik.is_owner(workspace_id)) AND derslik.can_lesson_board(workspace_id,student_id,lesson_id,true))
 WITH CHECK(workspace_id=derslik.workspace_id() AND (author_id=derslik.actor_id() OR derslik.is_owner(workspace_id)) AND derslik.can_lesson_board(workspace_id,student_id,lesson_id,true));
CREATE POLICY lesson_stroke_delete ON derslik.lesson_board_strokes FOR DELETE
 USING(workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id) AND derslik.can_lesson_board(workspace_id,student_id,lesson_id,true));
GRANT SELECT,INSERT,UPDATE ON derslik.lesson_boards TO derslik_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON derslik.lesson_board_strokes TO derslik_app;
--> statement-breakpoint
-- Görüşme bağlantısı mevcut ders hatırlatmalarına eklenir.
DROP FUNCTION derslik.claim_lesson_reminders(int,int);
CREATE FUNCTION derslik.claim_lesson_reminders(lead_minutes int, batch int)
RETURNS TABLE(
 lesson_id uuid, workspace_id uuid, student_id uuid, starts_at timestamptz,
 topic text, location text, meeting_url text, student_name text, teacher_name text,
 recipient uuid, recipient_role text, email text, locale text
) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 WITH due AS (
  UPDATE derslik.lessons l SET reminded_at=now()
  WHERE l.id IN (
   SELECT x.id FROM derslik.lessons x
   JOIN derslik.students s ON s.workspace_id=x.workspace_id AND s.id=x.student_id AND s.active
   WHERE x.status='SCHEDULED' AND x.reminded_at IS NULL
    AND x.starts_at > now()
    AND x.starts_at <= now()+make_interval(mins=>least(greatest(lead_minutes,1),1440))
   ORDER BY x.starts_at
   LIMIT least(greatest(batch,1),500)
   FOR UPDATE OF x SKIP LOCKED)
  RETURNING l.id,l.workspace_id,l.student_id,l.starts_at,l.topic,l.location,l.meeting_url
 ), recipients AS (
  SELECT DISTINCT ON (d.id, r.user_id) d.id, d.workspace_id, d.student_id,
   d.starts_at, d.topic, d.location, d.meeting_url, r.user_id, r.role
  FROM due d
  JOIN LATERAL (
   SELECT w.owner_id AS user_id, 'OWNER'::text AS role, 0 AS rank
   FROM derslik.workspaces w WHERE w.id=d.workspace_id
   UNION ALL
   SELECT p.user_id, p.role, 1 FROM derslik.portal_links p
   WHERE p.workspace_id=d.workspace_id AND p.student_id=d.student_id
    AND p.revoked_at IS NULL AND 'lessons'=ANY(p.permissions)
  ) r ON true
  ORDER BY d.id, r.user_id, r.rank
 ), notices AS (
  INSERT INTO derslik.notifications(workspace_id,user_id,student_id,title,body,kind,target_id)
  SELECT r.workspace_id, r.user_id, r.student_id, 'notice.lessonReminder', r.topic, 'LESSON', r.id
  FROM recipients r
 )
 SELECT r.id, r.workspace_id, r.student_id, r.starts_at, r.topic, r.location, r.meeting_url,
  s.name, COALESCE(p.display_name, w.name), r.user_id, r.role,
  COALESCE(u.email,''), COALESCE(u.locale,'tr')
 FROM recipients r
 JOIN derslik.students s ON s.workspace_id=r.workspace_id AND s.id=r.student_id
 JOIN derslik.workspaces w ON w.id=r.workspace_id
 LEFT JOIN derslik.teacher_profiles p ON p.workspace_id=r.workspace_id
 LEFT JOIN derslik.users u ON u.id=r.user_id
 ORDER BY r.starts_at, r.id
$$;
REVOKE ALL ON FUNCTION derslik.claim_lesson_reminders(int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.claim_lesson_reminders(int,int) TO derslik_app;

--> statement-breakpoint
-- Takvim bağlantısı da aynı ders odasına gider.
DROP FUNCTION derslik.calendar_feed(text);
CREATE FUNCTION derslik.calendar_feed(feed_token text)
RETURNS TABLE(
 lesson_id uuid, version int, starts_at timestamptz, ends_at timestamptz,
 status text, topic text, location text, meeting_url text, student_name text,
 teacher_name text, viewer_role text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 WITH f AS (
  SELECT user_id FROM derslik.calendar_feeds WHERE token=feed_token
 ), scope AS (
  SELECT w.id AS workspace_id, NULL::uuid AS student_id, 'OWNER'::text AS role
  FROM f JOIN derslik.workspaces w ON w.owner_id=f.user_id
  JOIN derslik.memberships m ON m.workspace_id=w.id AND m.user_id=f.user_id
   AND m.role='OWNER' AND m.active
  UNION ALL
  SELECT p.workspace_id, p.student_id, p.role
  FROM f JOIN derslik.portal_links p ON p.user_id=f.user_id
  WHERE p.revoked_at IS NULL AND 'lessons'=ANY(p.permissions)
 ), visible AS (
  SELECT DISTINCT ON (l.id) l.id, l.version, l.starts_at, l.ends_at, l.status,
   l.topic, l.location, l.meeting_url, s.name AS student_name,
   COALESCE(tp.display_name, w.name) AS teacher_name, sc.role
  FROM scope sc
  JOIN derslik.lessons l ON l.workspace_id=sc.workspace_id
   AND (sc.student_id IS NULL OR l.student_id=sc.student_id)
  JOIN derslik.students s ON s.workspace_id=l.workspace_id AND s.id=l.student_id
  JOIN derslik.workspaces w ON w.id=l.workspace_id
  LEFT JOIN derslik.teacher_profiles tp ON tp.workspace_id=l.workspace_id
  WHERE l.status<>'CANCELLED' AND l.starts_at>=now()-interval '90 days'
   AND (sc.role='OWNER' OR s.active)
  ORDER BY l.id, (sc.role='OWNER') DESC, (sc.role='STUDENT') DESC
 )
 SELECT id, version, starts_at, ends_at, status, topic, location, meeting_url,
  student_name, teacher_name, role
 FROM (
  SELECT * FROM visible
  ORDER BY (ends_at<=now()), abs(extract(epoch FROM starts_at-now())), id
  LIMIT 2000
 ) kept ORDER BY starts_at, id
$$;
REVOKE ALL ON FUNCTION derslik.calendar_feed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.calendar_feed(text) TO derslik_app;
