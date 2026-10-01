-- Uygulama içi mesajlaşma: öğretmen bağlı her hesapla (öğrenci hesabı ve her
-- veli hesabı) ayrı ve bire bir yazışır; telefon numarası paylaşılmaz.
-- Yazışma bir portal bağlantısıdır (portal_links satırı), ayrı bir yazışma
-- tablosu yoktur. Daveti yeniden kabul eden hesap aynı bağlantıya, yani aynı
-- geçmişe döner; başka bir hesap yeni bağlantı alır, eski mesajları görmez.
-- Öğretmenin kendi çalışma alanındaki (veli olarak kabul ettiği) bağlantısı
-- yazışma sayılmaz. Paylaşımlara (`notes`) erişimi olan veli, çocuğunun
-- öğrenci hesabıyla öğretmen arasındaki yazışmayı okuyabilir, yazamaz.
-- Uygulama rolü tablolarda yalnızca SELECT yapar; her yazma ve her portal
-- okuması aşağıdaki SECURITY DEFINER fonksiyonlarından geçer.
CREATE UNIQUE INDEX portal_links_workspace_id ON derslik.portal_links(workspace_id,id);
CREATE TABLE derslik.messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 link_id uuid NOT NULL,
 sender_id uuid NOT NULL REFERENCES derslik.users(id),
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 2000 AND btrim(body)<>''),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,link_id) REFERENCES derslik.portal_links(workspace_id,id)
);
CREATE INDEX messages_thread ON derslik.messages(link_id,created_at DESC,id DESC);
CREATE TABLE derslik.message_reads (
 workspace_id uuid NOT NULL,
 link_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES derslik.users(id),
 read_at timestamptz NOT NULL,
 PRIMARY KEY(link_id,user_id),
 FOREIGN KEY(workspace_id,link_id) REFERENCES derslik.portal_links(workspace_id,id)
);
-- Bir yazışmada tek okunmamış bildirim; eşzamanlı gönderimde de.
CREATE UNIQUE INDEX notifications_one_unread_message ON derslik.notifications(user_id,target_id)
 WHERE kind='MESSAGE' AND read_at IS NULL;
ALTER TABLE derslik.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE derslik.notifications ADD CONSTRAINT notifications_kind_check
 CHECK(kind IN ('ASSIGNMENT','SUBMISSION','REVIEW','VIDEO','QUESTION','ANSWER','SUMMARY','REQUEST','REQUEST_DECISION','LESSON','MESSAGE'));
--> statement-breakpoint
ALTER TABLE derslik.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.messages FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON derslik.messages FOR ALL
 USING(workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id))
 WITH CHECK(workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id));
ALTER TABLE derslik.message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.message_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY own_message_reads ON derslik.message_reads FOR SELECT USING(user_id=derslik.actor_id());
REVOKE ALL ON derslik.messages,derslik.message_reads FROM PUBLIC;
GRANT SELECT ON derslik.messages,derslik.message_reads TO derslik_app;
--> statement-breakpoint
-- Çağıranın bu yazışmadaki yeri. `side='OWNER'` öğretmen rotalarıdır
-- (`student` boş): öğretmen her bağlantısının geçmişini okur, erişimi
-- kaldırılmış ya da öğrencisi arşivlenmiş olsa da; yazmak için bağlantı etkin
-- olmalı. `side='PORTAL'` öğrenci/veli rotalarıdır (`student` yoldaki
-- öğrenci): kendi etkin bağlantısında SELF (yazabilir), değilse paylaşımlara
-- erişimi olan veli çocuğun etkin öğrenci bağlantısında GUARDIAN_READ
-- (yalnızca okur). Başka her durumda satır dönmez.
CREATE FUNCTION derslik.message_access(ws uuid,student uuid,link uuid,side text)
RETURNS TABLE(workspace_id uuid,student_id uuid,role text,user_id uuid,viewer text,can_send boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT l.workspace_id,l.student_id,l.role,l.user_id,v.viewer,
  CASE WHEN v.viewer='OWNER' THEN l.revoked_at IS NULL AND s.active ELSE v.viewer='SELF' END
 FROM derslik.portal_links l
 JOIN derslik.workspaces w ON w.id=l.workspace_id
 JOIN derslik.students s ON s.workspace_id=l.workspace_id AND s.id=l.student_id
 CROSS JOIN LATERAL (SELECT CASE
  WHEN side='OWNER' THEN
   CASE WHEN student IS NULL AND derslik.is_owner(ws) THEN 'OWNER' END
  WHEN side='PORTAL' AND l.student_id=student AND l.revoked_at IS NULL AND s.active THEN
   CASE
    WHEN l.user_id=derslik.actor_id() THEN 'SELF'
    WHEN l.role='STUDENT' AND derslik.actor_id()<>w.owner_id AND EXISTS(
     SELECT 1 FROM derslik.portal_links g
     WHERE g.workspace_id=l.workspace_id AND g.student_id=l.student_id
      AND g.user_id=derslik.actor_id() AND g.role='GUARDIAN'
      AND g.revoked_at IS NULL AND 'notes'=ANY(g.permissions)) THEN 'GUARDIAN_READ'
   END
 END AS viewer) v
 WHERE l.id=link AND l.workspace_id=ws AND l.user_id<>w.owner_id AND v.viewer IS NOT NULL
$$;
--> statement-breakpoint
-- Yazışma listesi. Öğretmen görünümü (`student` boş): çalışma alanının etkin
-- ya da mesajı olan bütün bağlantıları; `for_student` tek öğrenciye, `only_link`
-- tek bağlantıya indirir (o zaman mesajı olmayan kapalı bağlantı da açılır).
-- Portal görünümü (`student` dolu): çağıranın o öğrencideki kendi bağlantıları
-- ve okuyabildiği çocuk yazışması. Veli e-postası yalnızca öğretmene ve
-- öğretmenin gönderip kabul edilen davetinden gelir; hesabın e-postası değil.
-- `guardian_readers`: öğrenci yazışmasını okuyabilen veli hesabı sayısı.
CREATE FUNCTION derslik.message_threads(ws uuid,student uuid,only_link uuid,for_student uuid)
RETURNS TABLE(
 link_id uuid,role text,student_id uuid,student_name text,teacher_name text,
 guardian_email text,viewer text,can_send boolean,active boolean,guardian_readers int,
 last_body text,last_at timestamptz,last_mine boolean,unread int
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT l.id,l.role,l.student_id,s.name,COALESCE(NULLIF(btrim(tp.display_name),''),w.name),
  CASE WHEN a.viewer='OWNER' AND l.role='GUARDIAN' THEN (
   SELECT i.email FROM derslik.invitations i JOIN derslik.users u ON u.id=l.user_id
   WHERE i.workspace_id=l.workspace_id AND i.student_id=l.student_id AND i.role='GUARDIAN'
    AND i.accepted_at IS NOT NULL AND btrim(u.email)<>'' AND lower(i.email)=lower(btrim(u.email))
   ORDER BY i.accepted_at DESC LIMIT 1) END,
  a.viewer,a.can_send,l.revoked_at IS NULL AND s.active,
  CASE WHEN l.role='STUDENT' AND a.viewer IN ('OWNER','SELF') AND l.revoked_at IS NULL AND s.active THEN (
   SELECT count(*)::int FROM derslik.portal_links g
   WHERE g.workspace_id=l.workspace_id AND g.student_id=l.student_id AND g.role='GUARDIAN'
    AND g.revoked_at IS NULL AND 'notes'=ANY(g.permissions)
    AND g.user_id<>w.owner_id AND g.user_id<>l.user_id) ELSE 0 END,
  lm.body,lm.created_at,COALESCE(lm.sender_id=derslik.actor_id(),false),
  (SELECT count(*)::int FROM derslik.messages m
   WHERE m.link_id=l.id AND m.sender_id<>derslik.actor_id()
    AND m.created_at>COALESCE((SELECT r.read_at FROM derslik.message_reads r
     WHERE r.link_id=l.id AND r.user_id=derslik.actor_id()),'-infinity'))
 FROM derslik.portal_links l
 JOIN derslik.workspaces w ON w.id=l.workspace_id
 JOIN derslik.students s ON s.workspace_id=l.workspace_id AND s.id=l.student_id
 LEFT JOIN derslik.teacher_profiles tp ON tp.workspace_id=l.workspace_id
 CROSS JOIN LATERAL derslik.message_access(ws,student,l.id,
  CASE WHEN student IS NULL THEN 'OWNER' ELSE 'PORTAL' END) a
 LEFT JOIN LATERAL (
  SELECT left(m.body,200) AS body,m.created_at,m.sender_id FROM derslik.messages m
  WHERE m.link_id=l.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1
 ) lm ON true
 WHERE l.workspace_id=ws
  AND (student IS NULL OR l.student_id=student)
  AND (for_student IS NULL OR l.student_id=for_student)
  AND (only_link IS NULL OR l.id=only_link)
  AND (only_link IS NOT NULL OR a.viewer<>'OWNER' OR (l.revoked_at IS NULL AND s.active) OR lm.created_at IS NOT NULL)
 ORDER BY lm.created_at DESC NULLS LAST,s.name,l.role DESC,l.created_at,l.id
$$;
--> statement-breakpoint
-- Yazışmanın mesajları, en yeniden eskiye: `before` anından öncekilerden en
-- fazla `max_rows` tane (1-100). Gönderen, bağlantının kendisine göre yazılır:
-- öğretmen, bağlantının hesabı (öğrenci/veli) ya da başka biri.
CREATE FUNCTION derslik.message_thread(ws uuid,student uuid,link uuid,side text,before_at timestamptz,max_rows int)
RETURNS TABLE(id uuid,sender_role text,mine boolean,body text,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT m.id,
  CASE WHEN m.sender_id=w.owner_id THEN 'OWNER' WHEN m.sender_id=l.user_id THEN l.role ELSE 'OTHER' END,
  m.sender_id=derslik.actor_id(),m.body,m.created_at
 FROM derslik.message_access(ws,student,link,side) a
 JOIN derslik.portal_links l ON l.id=link
 JOIN derslik.workspaces w ON w.id=l.workspace_id
 JOIN derslik.messages m ON m.link_id=l.id
 WHERE m.created_at<COALESCE(before_at,'infinity')
 ORDER BY m.created_at DESC,m.id DESC
 LIMIT least(greatest(max_rows,1),100)
$$;
--> statement-breakpoint
-- Mesaj gönderimi. Kilit sırası erişim kaldırma ve arşivlemeyle aynıdır
-- (önce öğrenci, sonra bağlantı): onlar öğrenci satırını FOR UPDATE tutar,
-- gönderim FOR SHARE bekler; erişim aynı anda kalkarsa mesaj yazılmaz.
-- Bağlantı kilidi aynı yazışmadaki gönderim ve okumaları sıraya sokar.
-- Mesaj zamanı milisaniyeye yuvarlanır ve yazışmada her mesajda artar: istemci
-- zamanı ISO biçiminde (milisaniye) geri gönderir, önceki sayfa böylece
-- kaçırmadan ve tekrarlamadan alınır. Alıcıya yazışma başına tek okunmamış
-- bildirim gider (yeni mesaj onu günceller); veli çocuğunun yazışması için
-- bildirim almaz.
CREATE FUNCTION derslik.send_message(ws uuid,student uuid,link uuid,side text,message_body text)
RETURNS TABLE(id uuid,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
#variable_conflict use_column
DECLARE a record; sid uuid; msg uuid; sent_at timestamptz; owner_user uuid; teacher_name text;
 pupil text; recipient uuid; title_key text; sender_name text; preview text;
BEGIN
 SELECT l.student_id INTO sid FROM derslik.portal_links l WHERE l.id=link AND l.workspace_id=ws;
 IF sid IS NOT NULL THEN
  PERFORM 1 FROM derslik.students s WHERE s.workspace_id=ws AND s.id=sid FOR SHARE;
  PERFORM 1 FROM derslik.portal_links l WHERE l.id=link FOR UPDATE;
 END IF;
 SELECT * INTO a FROM derslik.message_access(ws,student,link,side);
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Message thread unavailable' USING ERRCODE='42501', HINT='not_found';
 END IF;
 IF NOT a.can_send THEN
  RAISE EXCEPTION 'Message thread unavailable' USING ERRCODE='42501', HINT='closed';
 END IF;
 INSERT INTO derslik.users(id) VALUES(derslik.actor_id()) ON CONFLICT DO NOTHING;
 SELECT greatest(date_trunc('milliseconds',clock_timestamp()),max(m.created_at)+interval '1 millisecond')
 INTO sent_at FROM derslik.messages m WHERE m.link_id=link;
 msg:=gen_random_uuid();
 INSERT INTO derslik.messages(id,workspace_id,link_id,sender_id,body,created_at)
 VALUES(msg,ws,link,derslik.actor_id(),message_body,sent_at);
 -- Yazan, yazışmayı o ana kadar okumuş sayılır.
 INSERT INTO derslik.message_reads(workspace_id,link_id,user_id,read_at)
 VALUES(ws,link,derslik.actor_id(),sent_at)
 ON CONFLICT (link_id,user_id) DO UPDATE SET read_at=greatest(message_reads.read_at,EXCLUDED.read_at);
 UPDATE derslik.notifications n SET read_at=clock_timestamp()
 WHERE n.user_id=derslik.actor_id() AND n.kind='MESSAGE' AND n.target_id=link AND n.read_at IS NULL;
 SELECT w.owner_id,COALESCE(NULLIF(btrim(tp.display_name),''),w.name),s.name INTO owner_user,teacher_name,pupil
 FROM derslik.workspaces w
 JOIN derslik.students s ON s.workspace_id=w.id AND s.id=a.student_id
 LEFT JOIN derslik.teacher_profiles tp ON tp.workspace_id=w.id
 WHERE w.id=ws;
 -- Öğrenci ve veli, öğrenci kaydının adıyla görünür; başlık velinin yazdığını söyler.
 IF a.viewer='OWNER' THEN
  recipient:=a.user_id; title_key:='notice.messageFromTeacher'; sender_name:=teacher_name;
 ELSE
  recipient:=owner_user; sender_name:=pupil;
  title_key:=CASE WHEN a.role='GUARDIAN' THEN 'notice.messageFromGuardian' ELSE 'notice.messageFromStudent' END;
 END IF;
 preview:=btrim(regexp_replace(message_body,'\s+',' ','g'));
 IF char_length(preview)>140 THEN preview:=left(preview,140)||'…'; END IF;
 IF recipient<>derslik.actor_id() THEN
  INSERT INTO derslik.notifications(workspace_id,user_id,student_id,title,body,kind,target_id,created_at)
  VALUES(ws,recipient,a.student_id,title_key,sender_name||': '||preview,'MESSAGE',link,sent_at)
  ON CONFLICT (user_id,target_id) WHERE kind='MESSAGE' AND read_at IS NULL
  DO UPDATE SET title=EXCLUDED.title,body=EXCLUDED.body,created_at=EXCLUDED.created_at;
 END IF;
 RETURN QUERY SELECT msg,sent_at;
END $$;
--> statement-breakpoint
-- Yazışmayı açan kişi onu okumuş sayılır; bu yazışmanın okunmamış bildirimi
-- de okunur. Bağlantı kilidi, aynı anda gelen mesajın okunmamış kalmasını
-- sağlar (kilit gönderimden sonra alınırsa o mesaj da okunmuş sayılır).
CREATE FUNCTION derslik.read_messages(ws uuid,student uuid,link uuid,side text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE seen timestamptz; BEGIN
 PERFORM 1 FROM derslik.portal_links l WHERE l.id=link AND l.workspace_id=ws FOR UPDATE;
 PERFORM 1 FROM derslik.message_access(ws,student,link,side);
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT greatest(clock_timestamp(),max(m.created_at)) INTO seen FROM derslik.messages m WHERE m.link_id=link;
 INSERT INTO derslik.message_reads(workspace_id,link_id,user_id,read_at)
 VALUES(ws,link,derslik.actor_id(),seen)
 ON CONFLICT (link_id,user_id) DO UPDATE SET read_at=greatest(message_reads.read_at,EXCLUDED.read_at);
 UPDATE derslik.notifications n SET read_at=clock_timestamp()
 WHERE n.user_id=derslik.actor_id() AND n.kind='MESSAGE' AND n.target_id=link AND n.read_at IS NULL;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION derslik.message_access(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.message_access(uuid,uuid,uuid,text) TO derslik_app;
REVOKE ALL ON FUNCTION derslik.message_threads(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.message_threads(uuid,uuid,uuid,uuid) TO derslik_app;
REVOKE ALL ON FUNCTION derslik.message_thread(uuid,uuid,uuid,text,timestamptz,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.message_thread(uuid,uuid,uuid,text,timestamptz,int) TO derslik_app;
REVOKE ALL ON FUNCTION derslik.send_message(uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.send_message(uuid,uuid,uuid,text,text) TO derslik_app;
REVOKE ALL ON FUNCTION derslik.read_messages(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.read_messages(uuid,uuid,uuid,text) TO derslik_app;
