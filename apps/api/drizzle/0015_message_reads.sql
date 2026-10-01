-- Okundu bilgisi artık istemcinin gördüğü en yeni mesaja kadar yazılır.
-- Önceden okuma anı (mikrosaniyeli saat) yazılıyordu: kilidi bekleyen ve
-- zamanı milisaniyeye yuvarlanan bir mesaj, okuyanın hiç görmediği hâlde
-- okunmuş sayılabiliyordu; sayfa alındıktan sonra gelen mesaj da okunma
-- isteğiyle okunmuş sayılıyordu. Gönderim de yazanın okundu bilgisine artık
-- dokunmaz: kişinin kendi mesajı zaten okunmamış sayılmaz, karşı taraftan
-- gelip henüz görülmemiş mesaj da okunmuş sayılmamalı.
DROP FUNCTION derslik.read_messages(uuid,uuid,uuid,text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION derslik.send_message(ws uuid,student uuid,link uuid,side text,message_body text)
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
-- Yazışmayı açan kişi `up_to` anına (gördüğü en yeni mesajın zamanı) kadar
-- okumuş sayılır; daha yeni bir mesaj olsa da sonrası okunmamış kalır.
-- `up_to` boşsa yazışmanın en yeni mesajına kadar. Okunmamış bildirim, karşı
-- taraftan okunmamış mesaj kalmadıysa okunur. Bağlantı kilidi okumayı aynı
-- yazışmadaki gönderimle sıraya sokar.
CREATE FUNCTION derslik.read_messages(ws uuid,student uuid,link uuid,side text,up_to timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE seen timestamptz; BEGIN
 PERFORM 1 FROM derslik.portal_links l WHERE l.id=link AND l.workspace_id=ws FOR UPDATE;
 PERFORM 1 FROM derslik.message_access(ws,student,link,side);
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT max(m.created_at) INTO seen FROM derslik.messages m WHERE m.link_id=link;
 IF up_to IS NOT NULL AND seen IS NOT NULL THEN seen:=least(seen,up_to); END IF;
 IF seen IS NOT NULL THEN
  INSERT INTO derslik.message_reads(workspace_id,link_id,user_id,read_at)
  VALUES(ws,link,derslik.actor_id(),seen)
  ON CONFLICT (link_id,user_id) DO UPDATE SET read_at=greatest(message_reads.read_at,EXCLUDED.read_at);
 END IF;
 UPDATE derslik.notifications n SET read_at=clock_timestamp()
 WHERE n.user_id=derslik.actor_id() AND n.kind='MESSAGE' AND n.target_id=link AND n.read_at IS NULL
  AND NOT EXISTS(
   SELECT 1 FROM derslik.messages m
   WHERE m.link_id=link AND m.sender_id<>derslik.actor_id()
    AND m.created_at>COALESCE((SELECT r.read_at FROM derslik.message_reads r
     WHERE r.link_id=link AND r.user_id=derslik.actor_id()),'-infinity'));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION derslik.read_messages(uuid,uuid,uuid,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.read_messages(uuid,uuid,uuid,text,timestamptz) TO derslik_app;
