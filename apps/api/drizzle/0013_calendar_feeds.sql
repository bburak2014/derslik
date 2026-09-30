-- Takvim aboneliği: her hesap Google/Apple Takvim'e bir kez eklediği gizli bir
-- bağlantı alır; takvim uygulaması dersleri bu bağlantıdan düzenli okur.
-- Takvim uygulamaları oturum açamaz, bu yüzden bağlantıdaki belirteç tek
-- anahtardır. Kişi bağlantıyı başka bir cihaza eklemek için yeniden
-- görebilsin diye belirteç açık saklanır; tablo yalnızca sahibine açıktır
-- (RLS) ve bağlantı sızarsa yenilenir (eskisi hemen çalışmaz). Veritabanını
-- okuyabilen biri dersleri zaten görür; özet saklamak burada koruma katmaz.
CREATE TABLE derslik.calendar_feeds (
 user_id uuid PRIMARY KEY REFERENCES derslik.users(id),
 token text NOT NULL UNIQUE CHECK(token ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE derslik.calendar_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.calendar_feeds FORCE ROW LEVEL SECURITY;
CREATE POLICY own_calendar_feed ON derslik.calendar_feeds
 USING(user_id=derslik.actor_id()) WITH CHECK(user_id=derslik.actor_id());
GRANT SELECT,INSERT,UPDATE ON derslik.calendar_feeds TO derslik_app;
--> statement-breakpoint
-- Bağlantının sahibinin dili; bağlantı yoksa satır dönmez.
CREATE FUNCTION derslik.calendar_feed_owner(feed_token text)
RETURNS TABLE(locale text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT COALESCE(u.locale,'tr') FROM derslik.calendar_feeds f
 LEFT JOIN derslik.users u ON u.id=f.user_id
 WHERE f.token=feed_token
$$;
--> statement-breakpoint
-- Bağlantının sahibinin uygulamada gördüğü dersler: öğretmen kendi çalışma
-- alanının bütün derslerini, öğrenci/veli derslere erişimi olan etkin
-- bağlantılarındaki (arşivlenmemiş) öğrencinin derslerini. Erişim kalkınca
-- dersler bir sonraki okumada takvimden düşer. İptal edilen dersler dönmez;
-- abone takvim, akışta olmayan etkinliği siler. Son 90 günden eskisi ve
-- 2000'den fazlası alınmaz.
CREATE FUNCTION derslik.calendar_feed(feed_token text)
RETURNS TABLE(
 lesson_id uuid, version int, starts_at timestamptz, ends_at timestamptz,
 status text, topic text, location text, student_name text,
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
   l.topic, l.location, s.name AS student_name,
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
 SELECT id, version, starts_at, ends_at, status, topic, location,
  student_name, teacher_name, role
 FROM visible ORDER BY starts_at, id LIMIT 2000
$$;
REVOKE ALL ON FUNCTION derslik.calendar_feed_owner(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.calendar_feed_owner(text) TO derslik_app;
REVOKE ALL ON FUNCTION derslik.calendar_feed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.calendar_feed(text) TO derslik_app;
