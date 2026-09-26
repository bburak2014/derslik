-- Ders isteği: öğretmen reddederken isteğe bağlı kısa bir not yazabilir;
-- 7 gün yanıtsız kalan istek kendiliğinden düşer (EXPIRED) ve öğrenciye
-- bildirim gider. Zamanlayıcı yok: süre aşımı, istekleri okuyan her uçta
-- (öğrencinin listesi, öğretmenin kutusu, bildirimler) derslik.expire_requests()
-- ile uygulanır.
ALTER TABLE derslik.lesson_requests ADD COLUMN decision_note text NOT NULL DEFAULT '' CHECK(char_length(decision_note)<=300);
ALTER TABLE derslik.lesson_requests DROP CONSTRAINT IF EXISTS lesson_requests_status_check;
ALTER TABLE derslik.lesson_requests ADD CONSTRAINT lesson_requests_status_check
 CHECK(status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED'));
CREATE INDEX lesson_requests_pending ON derslik.lesson_requests(created_at) WHERE status='PENDING';
--> statement-breakpoint
-- Oturumdaki kişinin (isteyen öğrenci ya da istek alan öğretmen) süresi dolmuş
-- bekleyen isteklerini kapatır ve her biri için öğrenciye bildirim yazar.
CREATE FUNCTION derslik.expire_requests() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE r record; n int:=0; BEGIN
 FOR r IN
  UPDATE derslik.lesson_requests q SET status='EXPIRED',decided_at=now()
  WHERE q.status='PENDING' AND q.created_at < now()-interval '7 days'
   AND (q.user_id=derslik.actor_id() OR derslik.is_owner(q.workspace_id))
  RETURNING q.id,q.workspace_id,q.user_id
 LOOP
  INSERT INTO derslik.notifications(workspace_id,user_id,student_id,title,body,kind,target_id)
  SELECT r.workspace_id,r.user_id,NULL,'notice.requestExpired',COALESCE(p.display_name,w.name),'REQUEST_DECISION',r.id
  FROM derslik.workspaces w LEFT JOIN derslik.teacher_profiles p ON p.workspace_id=w.id WHERE w.id=r.workspace_id;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION derslik.expire_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.expire_requests() TO derslik_app;
