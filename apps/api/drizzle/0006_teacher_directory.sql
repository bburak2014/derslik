-- Öğretmen vitrini: öğretmenler kendilerini listeler, öğrenciler ders isteği
-- gönderir, öğretmen kabul edince öğrenci davetle katılmış gibi bağlanır.
CREATE TABLE derslik.teacher_profiles (
 workspace_id uuid PRIMARY KEY REFERENCES derslik.workspaces(id),
 display_name text NOT NULL CHECK(char_length(display_name) BETWEEN 2 AND 80),
 headline text NOT NULL DEFAULT '' CHECK(char_length(headline)<=120),
 bio text NOT NULL DEFAULT '' CHECK(char_length(bio)<=2000),
 subjects text[] NOT NULL DEFAULT '{}' CHECK(cardinality(subjects)<=6),
 levels text[] NOT NULL DEFAULT '{}' CHECK(cardinality(levels)<=10),
 lesson_modes text[] NOT NULL DEFAULT ARRAY['ONLINE'] CHECK(cardinality(lesson_modes) BETWEEN 1 AND 2 AND lesson_modes <@ ARRAY['ONLINE','IN_PERSON']),
 city text NOT NULL DEFAULT '' CHECK(char_length(city)<=60),
 hourly_price int CHECK(hourly_price IS NULL OR hourly_price BETWEEN 0 AND 1000000),
 currency text NOT NULL DEFAULT 'TRY' CHECK(currency IN ('TRY','EUR','USD','GBP')),
 languages text[] NOT NULL DEFAULT '{}' CHECK(cardinality(languages)<=10),
 experience_years int CHECK(experience_years IS NULL OR experience_years BETWEEN 0 AND 80),
 photo bytea CHECK(photo IS NULL OR octet_length(photo)<=307200),
 photo_type text CHECK(photo_type IS NULL OR photo_type IN ('image/jpeg','image/png','image/webp')),
 photo_version int NOT NULL DEFAULT 0,
 published boolean NOT NULL DEFAULT false,
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE derslik.lesson_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES derslik.workspaces(id),
 user_id uuid NOT NULL REFERENCES derslik.users(id),
 student_name text NOT NULL CHECK(char_length(student_name) BETWEEN 2 AND 100),
 subject text NOT NULL CHECK(char_length(subject) BETWEEN 1 AND 40),
 level text NOT NULL DEFAULT '' CHECK(char_length(level)<=40),
 phone text NOT NULL DEFAULT '' CHECK(char_length(phone)<=30),
 email text NOT NULL DEFAULT '' CHECK(char_length(email)<=200),
 message text NOT NULL DEFAULT '' CHECK(char_length(message)<=1000),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED')),
 student_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 FOREIGN KEY(workspace_id,student_id) REFERENCES derslik.students(workspace_id,id)
);
CREATE UNIQUE INDEX one_pending_request ON derslik.lesson_requests(workspace_id,user_id) WHERE status='PENDING';
CREATE INDEX lesson_requests_user ON derslik.lesson_requests(user_id,created_at DESC);
CREATE INDEX lesson_requests_workspace ON derslik.lesson_requests(workspace_id,status,created_at DESC);
CREATE TABLE derslik.teacher_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES derslik.workspaces(id),
 user_id uuid NOT NULL REFERENCES derslik.users(id),
 author_name text NOT NULL CHECK(char_length(author_name) BETWEEN 1 AND 100),
 rating int NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment text NOT NULL DEFAULT '' CHECK(char_length(comment)<=500),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,user_id)
);
--> statement-breakpoint
ALTER TABLE derslik.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE derslik.notifications ADD CONSTRAINT notifications_kind_check
 CHECK(kind IN ('ASSIGNMENT','SUBMISSION','REVIEW','VIDEO','QUESTION','ANSWER','SUMMARY','REQUEST','REQUEST_DECISION'));
--> statement-breakpoint
-- Vitrinde görünme kuralı tek yerde durur. Şimdilik yayına alan her öğretmen
-- listelenir. İLERİDE: yalnızca ücretli paketteki öğretmenler görünecek; o gün
-- buraya workspace_limits.plan kontrolü eklenir.
CREATE FUNCTION derslik.is_listed(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT EXISTS(SELECT 1 FROM derslik.teacher_profiles p WHERE p.workspace_id=ws AND p.published);
$$;
-- Puan verebilen: bu öğretmene öğrenci hesabıyla bağlanmış (bağlantı sonradan
-- kaldırılmış olsa da) kişi. Dönüş değeri kayıttaki öğrenci adıdır.
CREATE FUNCTION derslik.review_author(ws uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT s.name FROM derslik.portal_links p JOIN derslik.students s ON s.workspace_id=p.workspace_id AND s.id=p.student_id
 WHERE p.workspace_id=ws AND p.user_id=derslik.actor_id() AND p.role='STUDENT' ORDER BY p.revoked_at IS NULL DESC,p.created_at DESC LIMIT 1;
$$;
-- Öğrenci şu anda bu öğretmene bağlı mı (istek yerine derslerine gider).
CREATE FUNCTION derslik.is_linked_student(ws uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT EXISTS(SELECT 1 FROM derslik.portal_links p JOIN derslik.students s ON s.workspace_id=p.workspace_id AND s.id=p.student_id
 WHERE p.workspace_id=ws AND p.user_id=derslik.actor_id() AND p.role='STUDENT' AND p.revoked_at IS NULL AND s.active);
$$;
CREATE FUNCTION derslik.public_teachers() RETURNS TABLE(
 id uuid,display_name text,headline text,bio text,subjects text[],levels text[],lesson_modes text[],city text,
 hourly_price int,currency text,languages text[],experience_years int,photo_version int,rating_average numeric,rating_count int,published_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT p.workspace_id,p.display_name,p.headline,p.bio,p.subjects,p.levels,p.lesson_modes,p.city,p.hourly_price,p.currency,p.languages,p.experience_years,
  CASE WHEN p.photo IS NULL THEN NULL ELSE p.photo_version END,
  (SELECT round(avg(r.rating),1) FROM derslik.teacher_reviews r WHERE r.workspace_id=p.workspace_id),
  (SELECT count(*)::int FROM derslik.teacher_reviews r WHERE r.workspace_id=p.workspace_id),
  p.published_at
 FROM derslik.teacher_profiles p WHERE derslik.is_listed(p.workspace_id);
$$;
CREATE FUNCTION derslik.public_reviews(ws uuid) RETURNS TABLE(id uuid,rating int,comment text,author_name text,created_at timestamptz,updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT r.id,r.rating,r.comment,r.author_name,r.created_at,r.updated_at FROM derslik.teacher_reviews r
 WHERE r.workspace_id=ws AND derslik.is_listed(ws) ORDER BY r.updated_at DESC LIMIT 50;
$$;
CREATE FUNCTION derslik.public_photo(ws uuid) RETURNS TABLE(photo bytea,photo_type text,photo_version int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT p.photo,p.photo_type,p.photo_version FROM derslik.teacher_profiles p
 WHERE p.workspace_id=ws AND p.photo IS NOT NULL AND (derslik.is_listed(ws) OR derslik.is_owner(ws) OR derslik.has_workspace_access(ws)
  OR EXISTS(SELECT 1 FROM derslik.lesson_requests q WHERE q.workspace_id=ws AND q.user_id=derslik.actor_id()));
$$;
-- Öğrencinin istek listesinde öğretmenin adı (vitrinden sonradan çıkmış olsa da).
CREATE FUNCTION derslik.request_teacher(ws uuid) RETURNS TABLE(display_name text,photo_version int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT COALESCE(p.display_name,w.name),CASE WHEN p.photo IS NULL THEN NULL ELSE p.photo_version END
 FROM derslik.workspaces w LEFT JOIN derslik.teacher_profiles p ON p.workspace_id=w.id
 WHERE w.id=ws AND EXISTS(SELECT 1 FROM derslik.lesson_requests q WHERE q.workspace_id=ws AND q.user_id=derslik.actor_id());
$$;
-- İstek bildirimleri: isteyen öğretmene, öğretmen isteyene yazar; başka kimseye değil.
CREATE FUNCTION derslik.request_notice(request uuid,title text,body text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE r derslik.lesson_requests; recipient uuid; notice_kind text; BEGIN
 SELECT * INTO r FROM derslik.lesson_requests WHERE id=request;
 IF r.id IS NULL THEN RETURN; END IF;
 IF r.user_id=derslik.actor_id() THEN
  SELECT owner_id INTO recipient FROM derslik.workspaces WHERE id=r.workspace_id; notice_kind:='REQUEST';
 ELSIF derslik.is_owner(r.workspace_id) THEN
  recipient:=r.user_id; notice_kind:='REQUEST_DECISION';
 ELSE RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 INSERT INTO derslik.notifications(workspace_id,user_id,student_id,title,body,kind,target_id)
 VALUES(r.workspace_id,recipient,r.student_id,title,body,notice_kind,r.id);
END $$;
-- Kabul: davet kabulüyle aynı sonuç. Öğrenci kaydı açılır (öğrenci sınırı
-- kontrol edilir), öğrenci hesabı ona bağlanır, istek kapanır.
CREATE FUNCTION derslik.accept_lesson_request(request uuid,subject_label text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE r derslik.lesson_requests; lim int; used int; sid uuid; was_active boolean; link_id uuid; BEGIN
 SELECT * INTO r FROM derslik.lesson_requests WHERE id=request FOR UPDATE;
 IF r.id IS NULL OR NOT derslik.is_owner(r.workspace_id) THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 IF r.status<>'PENDING' THEN RAISE EXCEPTION 'Request already decided' USING ERRCODE='P0001', HINT='decided'; END IF;
 INSERT INTO derslik.workspace_limits(workspace_id) VALUES(r.workspace_id) ON CONFLICT DO NOTHING;
 SELECT student_limit INTO lim FROM derslik.workspace_limits WHERE workspace_id=r.workspace_id FOR UPDATE;
 SELECT id,active INTO sid,was_active FROM derslik.students WHERE workspace_id=r.workspace_id AND user_id=r.user_id;
 IF sid IS NULL OR NOT was_active THEN
  SELECT count(*) INTO used FROM derslik.students WHERE workspace_id=r.workspace_id AND active;
  IF used>=lim THEN RAISE EXCEPTION 'Student limit reached' USING ERRCODE='P0001', HINT='limit'; END IF;
 END IF;
 IF sid IS NULL THEN
  INSERT INTO derslik.students(workspace_id,user_id,name,grade,subject,phone,email)
  VALUES(r.workspace_id,r.user_id,r.student_name,'',left(COALESCE(NULLIF(subject_label,''),r.subject),120),r.phone,r.email) RETURNING id INTO sid;
 ELSE
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
--> statement-breakpoint
ALTER TABLE derslik.teacher_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.teacher_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON derslik.teacher_profiles FOR ALL USING(derslik.is_owner(workspace_id)) WITH CHECK(derslik.is_owner(workspace_id));
ALTER TABLE derslik.lesson_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.lesson_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY requester_read ON derslik.lesson_requests FOR SELECT USING(user_id=derslik.actor_id());
CREATE POLICY requester_create ON derslik.lesson_requests FOR INSERT WITH CHECK(
 user_id=derslik.actor_id() AND status='PENDING' AND student_id IS NULL AND decided_at IS NULL
 AND derslik.is_listed(workspace_id) AND NOT derslik.is_owner(workspace_id) AND NOT derslik.is_linked_student(workspace_id));
CREATE POLICY requester_cancel ON derslik.lesson_requests FOR UPDATE USING(user_id=derslik.actor_id() AND status='PENDING')
 WITH CHECK(user_id=derslik.actor_id() AND status='CANCELLED' AND student_id IS NULL);
CREATE POLICY teacher_read ON derslik.lesson_requests FOR SELECT USING(derslik.is_owner(workspace_id));
CREATE POLICY teacher_decline ON derslik.lesson_requests FOR UPDATE USING(derslik.is_owner(workspace_id) AND status='PENDING')
 WITH CHECK(derslik.is_owner(workspace_id) AND status='DECLINED' AND student_id IS NULL);
ALTER TABLE derslik.teacher_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.teacher_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY own_review ON derslik.teacher_reviews FOR ALL USING(user_id=derslik.actor_id())
 WITH CHECK(user_id=derslik.actor_id() AND derslik.review_author(workspace_id) IS NOT NULL);
CREATE POLICY teacher_reviews_read ON derslik.teacher_reviews FOR SELECT USING(derslik.is_owner(workspace_id));
--> statement-breakpoint
REVOKE ALL ON derslik.teacher_profiles,derslik.lesson_requests,derslik.teacher_reviews FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON derslik.teacher_profiles,derslik.lesson_requests TO derslik_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON derslik.teacher_reviews TO derslik_app;
REVOKE ALL ON FUNCTION derslik.is_listed(uuid),derslik.review_author(uuid),derslik.is_linked_student(uuid),derslik.public_teachers(),
 derslik.public_reviews(uuid),derslik.public_photo(uuid),derslik.request_teacher(uuid),derslik.request_notice(uuid,text,text),
 derslik.accept_lesson_request(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.is_listed(uuid),derslik.review_author(uuid),derslik.is_linked_student(uuid),derslik.public_teachers(),
 derslik.public_reviews(uuid),derslik.public_photo(uuid),derslik.request_teacher(uuid),derslik.request_notice(uuid,text,text),
 derslik.accept_lesson_request(uuid,text) TO derslik_app;
