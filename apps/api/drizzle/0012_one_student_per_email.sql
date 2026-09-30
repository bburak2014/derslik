-- Bir öğretmenin öğrencileri arasında bir e-posta yalnızca bir kayıtta durur.
-- Aynı e-postalı ikinci kayıt açılabildiği için dersler ve bildirimler
-- öğrencinin artık bağlı olmadığı eski kayda gidebiliyordu. Büyük/küçük harf
-- ve baştaki/sondaki boşluk fark etmez; e-postası boş kayıtlar kurala girmez.
-- Farklı öğretmenlerde aynı e-posta olabilir (bir öğrencinin iki öğretmeni).
--
-- Var olan kopyalarda e-postayı en uygun kayıt korur: etkin öğrenci bağlantısı
-- olan, sonra aktif olan, sonra en yeni. Diğerlerinin yalnızca e-posta alanı
-- boşaltılır; kayıtlar ve geçmişleri silinmez.
WITH ranked AS (
 SELECT s.id, row_number() OVER (
  PARTITION BY s.workspace_id, lower(btrim(s.email))
  ORDER BY EXISTS(
    SELECT 1 FROM derslik.portal_links p
    WHERE p.workspace_id=s.workspace_id AND p.student_id=s.id
     AND p.role='STUDENT' AND p.revoked_at IS NULL) DESC,
   s.active DESC, s.created_at DESC, s.id) AS n
 FROM derslik.students s WHERE btrim(s.email)<>''
)
UPDATE derslik.students s SET email='', version=s.version+1
FROM ranked r WHERE s.id=r.id AND r.n>1;
CREATE UNIQUE INDEX students_workspace_email ON derslik.students(workspace_id, lower(btrim(email)))
 WHERE btrim(email)<>'';
--> statement-breakpoint
-- Ders isteği kabulü öğrenciyi yalnızca isteyenin hesabıyla (bağlantı veya
-- user_id) bulur, e-postayla birleştirmez: öğretmenin yazdığı e-posta
-- doğrulanmamıştır, veliye ait olabilir; birleştirme başkasının geçmişini
-- açardı. Yeni kaydın e-postası bu öğretmende başka bir kayıtta varsa boş
-- bırakılır, böylece kural bozulmaz ve kabul reddedilmez.
CREATE OR REPLACE FUNCTION derslik.accept_lesson_request(request uuid,subject_label text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE r derslik.lesson_requests; lim int; used int; sid uuid; was_active boolean; link_id uuid; BEGIN
 SELECT * INTO r FROM derslik.lesson_requests WHERE id=request FOR UPDATE;
 IF r.id IS NULL OR NOT derslik.is_owner(r.workspace_id) THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 IF r.status<>'PENDING' THEN RAISE EXCEPTION 'Request already decided' USING ERRCODE='P0001', HINT='decided'; END IF;
 INSERT INTO derslik.workspace_limits(workspace_id) VALUES(r.workspace_id) ON CONFLICT DO NOTHING;
 SELECT student_limit INTO lim FROM derslik.workspace_limits WHERE workspace_id=r.workspace_id FOR UPDATE;
 SELECT s.id,s.active INTO sid,was_active FROM derslik.students s
 LEFT JOIN derslik.portal_links p ON p.workspace_id=s.workspace_id AND p.student_id=s.id AND p.user_id=r.user_id AND p.role='STUDENT'
 WHERE s.workspace_id=r.workspace_id AND (s.user_id=r.user_id OR p.id IS NOT NULL)
 ORDER BY (p.id IS NOT NULL AND p.revoked_at IS NULL) DESC,s.user_id IS NOT DISTINCT FROM r.user_id DESC,s.active DESC,p.created_at DESC NULLS LAST
 LIMIT 1;
 IF sid IS NULL OR NOT was_active THEN
  SELECT count(*) INTO used FROM derslik.students WHERE workspace_id=r.workspace_id AND active;
  IF used>=lim THEN RAISE EXCEPTION 'Student limit reached' USING ERRCODE='P0001', HINT='limit'; END IF;
 END IF;
 IF sid IS NULL THEN
  INSERT INTO derslik.students(workspace_id,user_id,name,grade,subject,phone,email)
  VALUES(r.workspace_id,r.user_id,r.student_name,'',left(COALESCE(NULLIF(subject_label,''),r.subject),120),r.phone,
   CASE WHEN btrim(r.email)='' OR EXISTS(
    SELECT 1 FROM derslik.students s WHERE s.workspace_id=r.workspace_id
     AND btrim(s.email)<>'' AND lower(btrim(s.email))=lower(btrim(r.email)))
   THEN '' ELSE r.email END) RETURNING id INTO sid;
 ELSIF NOT was_active THEN
  UPDATE derslik.students SET active=true,version=version+1 WHERE workspace_id=r.workspace_id AND id=sid;
 END IF;
 INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions)
 VALUES(r.workspace_id,sid,r.user_id,'STUDENT',ARRAY['lessons','assignments','videos','notes'])
 ON CONFLICT(workspace_id,student_id,user_id,role) DO UPDATE SET revoked_at=NULL RETURNING id INTO link_id;
 INSERT INTO derslik.memberships(workspace_id,user_id,role) VALUES(r.workspace_id,r.user_id,'STUDENT')
 ON CONFLICT(workspace_id,user_id,role) DO UPDATE SET active=true;
 UPDATE derslik.lesson_requests SET status='ACCEPTED',student_id=sid,decided_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('id',r.id,'studentId',sid,'workspaceId',r.workspace_id,'linkId',link_id);
END $$;
