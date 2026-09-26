-- Ders isteği kabulü, öğrenci bu öğretmene daha önce davetle bağlandıysa
-- yeni kayıt açmaz. Davet kabulü students.user_id'yi doldurmaz, bağlantı
-- portal_links'te durur; eski fonksiyon yalnızca user_id'ye baktığı için
-- ikinci bir öğrenci kaydı açıyor, geçmiş bölünüyor ve öğrenci sınırından
-- iki kez düşüyordu. Kayıt önce etkin bağlantıdan, sonra user_id'den, en son
-- kaldırılmış bağlantıdan bulunur.
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
  VALUES(r.workspace_id,r.user_id,r.student_name,'',left(COALESCE(NULLIF(subject_label,''),r.subject),120),r.phone,r.email) RETURNING id INTO sid;
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
