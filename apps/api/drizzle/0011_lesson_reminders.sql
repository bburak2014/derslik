-- Ders hatırlatması: dersten bir süre önce öğretmene, öğrenciye ve veliye
-- uygulama içi bildirim ve e-posta gider. API içindeki zamanlayıcı her dakika
-- derslik.claim_lesson_reminders() ile vakti gelen dersleri alır. Fonksiyon
-- dersi hatırlatıldı olarak işaretler ve bildirimleri aynı işlemde yazar;
-- iki API kopyası aynı dersi iki kez hatırlatamaz (SKIP LOCKED + reminded_at).
-- E-posta adresi ve dil, kişinin kendi oturumundan (bildirimler okunurken)
-- users satırına yazılır; hiç giriş yapmamış kişiye e-posta gitmez.
ALTER TABLE derslik.users
 ADD COLUMN email text NOT NULL DEFAULT '' CHECK(char_length(email)<=320),
 ADD COLUMN locale text NOT NULL DEFAULT 'tr' CHECK(locale IN ('tr','en','de','fr','es','zh','ja'));
ALTER TABLE derslik.lessons ADD COLUMN reminded_at timestamptz;
CREATE INDEX lessons_reminder_due ON derslik.lessons(starts_at)
 WHERE status='SCHEDULED' AND reminded_at IS NULL;
ALTER TABLE derslik.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE derslik.notifications ADD CONSTRAINT notifications_kind_check
 CHECK(kind IN ('ASSIGNMENT','SUBMISSION','REVIEW','VIDEO','QUESTION','ANSWER','SUMMARY','REQUEST','REQUEST_DECISION','LESSON'));
--> statement-breakpoint
-- Önümüzdeki `lead_minutes` dakika içinde başlayacak, henüz hatırlatılmamış
-- planlı dersleri (arşivlenmemiş öğrencilerde) en fazla `batch` tane alır.
-- Alıcılar: öğretmen ve derslere erişimi olan öğrenci/veli bağlantıları.
-- Her alıcı için bir bildirim yazar ve e-posta için gereken bilgiyi döndürür.
CREATE FUNCTION derslik.claim_lesson_reminders(lead_minutes int, batch int)
RETURNS TABLE(
 lesson_id uuid, workspace_id uuid, student_id uuid, starts_at timestamptz,
 topic text, location text, student_name text, teacher_name text,
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
  RETURNING l.id,l.workspace_id,l.student_id,l.starts_at,l.topic,l.location
 ), recipients AS (
  SELECT DISTINCT ON (d.id, r.user_id) d.id, d.workspace_id, d.student_id,
   d.starts_at, d.topic, d.location, r.user_id, r.role
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
 SELECT r.id, r.workspace_id, r.student_id, r.starts_at, r.topic, r.location,
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
