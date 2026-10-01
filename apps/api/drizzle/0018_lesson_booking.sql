-- Öğrencinin boş saatten ders ayarlaması (2/2): kurallar. Öğrenci (yalnızca
-- STUDENT bağlantısı) boş saatleri görür, ders ayarlar ve kendi ayarladığı
-- dersi iptal eder. Fonksiyonlar SECURITY DEFINER'dır: öğrenci başka
-- öğrencilerin derslerini, ayar tablolarını ve (izni yoksa) paketlerini
-- doğrudan okumaz. Saatler İstanbul saatiyle hesaplanır.

-- Çağıran kişi bu öğrencinin geri alınmamış, Dersler izinli öğrenci hesabı mı
-- (öğrenci arşivde değil).
CREATE FUNCTION derslik.booking_student(ws uuid,student uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT EXISTS(SELECT 1 FROM derslik.portal_links p
  JOIN derslik.students s ON s.workspace_id=p.workspace_id AND s.id=p.student_id
  WHERE p.workspace_id=ws AND p.student_id=student AND p.user_id=derslik.actor_id()
   AND p.role='STUDENT' AND p.revoked_at IS NULL AND 'lessons'=ANY(p.permissions) AND s.active);
$$;
--> statement-breakpoint
-- Portal ve ayarlama penceresi için ayarların gösterilebilen kısmı; çalışma
-- alanına erişimi olan herkes okur.
CREATE FUNCTION derslik.booking_policy(ws uuid)
RETURNS TABLE(enabled boolean,duration_minutes int,cancel_hours int,location text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT b.enabled,b.duration_minutes,b.cancel_hours,b.location FROM derslik.booking_settings b
 WHERE b.workspace_id=ws AND derslik.has_workspace_access(ws);
$$;
--> statement-breakpoint
-- Öğrencinin paketleri ve boştaki hakları: kalan hak − o pakete bağlı planlı
-- ders. Geçmişte kalıp hâlâ planlı görünen ders de sayılır; büyük olasılıkla
-- tamamlanacaktır.
CREATE FUNCTION derslik.booking_packages(ws uuid,student uuid)
RETURNS TABLE(id uuid,expires_on date,created_at timestamptz,free int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT p.id,p.expires_on,p.created_at,
  p.remaining-(SELECT count(*) FROM derslik.lessons l
   WHERE l.workspace_id=p.workspace_id AND l.package_id=p.id AND l.status='SCHEDULED')::int
 FROM derslik.packages p
 WHERE p.workspace_id=ws AND p.student_id=student AND derslik.booking_student(ws,student);
$$;
--> statement-breakpoint
-- Önümüzdeki 28 günün (bugün dahil) boş ders başlangıçları. Başlangıçlar
-- aralığın başından 30 dakikada birdir ve dersin tamamı aralığa sığar. Kapalı
-- günler, en az ne kadar önce kuralı, öğretmenin iptal edilmemiş bütün
-- dersleri ve öğrencinin o günü kapsayan boştaki hakkı denetlenir. Sabitler
-- packages/contracts/src/booking.ts ile aynı olmalı.
CREATE FUNCTION derslik.open_slots(ws uuid,student uuid)
RETURNS TABLE(starts_at timestamptz,ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 WITH rules AS (
  SELECT b.duration_minutes,b.notice_hours FROM derslik.booking_settings b
  WHERE b.workspace_id=ws AND b.enabled AND derslik.booking_student(ws,student)
 ), credit AS (
  SELECT p.expires_on FROM derslik.booking_packages(ws,student) p WHERE p.free>0
 ), days AS (
  SELECT (now() AT TIME ZONE 'Europe/Istanbul')::date+i AS on_day FROM generate_series(0,27) i
 ), candidates AS (
  SELECT d.on_day,r.duration_minutes,r.notice_hours,
   (d.on_day+make_interval(mins=>m)) AT TIME ZONE 'Europe/Istanbul' AS start_at
  FROM rules r CROSS JOIN days d
  JOIN derslik.availability_windows w ON w.workspace_id=ws AND w.weekday=extract(isodow FROM d.on_day)
  CROSS JOIN LATERAL generate_series(w.start_minute::int,w.end_minute-r.duration_minutes,30) m
 )
 SELECT c.start_at,c.start_at+make_interval(mins=>c.duration_minutes)
 FROM candidates c
 WHERE c.start_at>=now()+make_interval(hours=>c.notice_hours)
  AND NOT EXISTS(SELECT 1 FROM derslik.availability_blocks k
   WHERE k.workspace_id=ws AND c.on_day BETWEEN k.starts_on AND k.ends_on)
  AND NOT EXISTS(SELECT 1 FROM derslik.lessons l
   WHERE l.workspace_id=ws AND l.status<>'CANCELLED'
    AND tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(c.start_at,c.start_at+make_interval(mins=>c.duration_minutes),'[)'))
  AND EXISTS(SELECT 1 FROM credit k WHERE k.expires_on IS NULL OR k.expires_on>=c.on_day)
 ORDER BY 1;
$$;
--> statement-breakpoint
-- Bugün geçerli paketlerdeki boştaki haklar (ayarlama penceresinin özeti).
CREATE FUNCTION derslik.free_credits(ws uuid,student uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT COALESCE(sum(greatest(p.free,0)),0)::int FROM derslik.booking_packages(ws,student) p
 WHERE p.expires_on IS NULL OR p.expires_on>=(now() AT TIME ZONE 'Europe/Istanbul')::date;
$$;
--> statement-breakpoint
-- Ders ayarlama. Kilit sırası öğretmenin ders eklemesiyle aynıdır: takvim
-- kilidi (LessonsService.calendarLock), öğrenci satırı, paket. Ayar satırı
-- FOR SHARE tutulur; öğretmen ayarı kaydederken (UPDATE) ayarlama bekler ve
-- kapatılmış ayara ders yazılmaz. Saat open_slots'ta yoksa: o günü kapsayan
-- boştaki hak yoksa 'credits', varsa 'slot'.
CREATE FUNCTION derslik.book_lesson(ws uuid,student uuid,start_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE pupil derslik.students; rules derslik.booking_settings; on_day date; pack uuid; created derslik.lessons;
BEGIN
 IF NOT derslik.booking_student(ws,student) THEN
  RAISE EXCEPTION 'Booking unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('calendar:'||ws::text,0));
 SELECT * INTO pupil FROM derslik.students s WHERE s.workspace_id=ws AND s.id=student FOR UPDATE;
 IF NOT pupil.active THEN
  RAISE EXCEPTION 'Student archived' USING ERRCODE='P0001',HINT='archived';
 END IF;
 SELECT * INTO rules FROM derslik.booking_settings b WHERE b.workspace_id=ws FOR SHARE;
 IF NOT FOUND OR NOT rules.enabled THEN
  RAISE EXCEPTION 'Booking disabled' USING ERRCODE='P0001',HINT='disabled';
 END IF;
 on_day:=(start_at AT TIME ZONE 'Europe/Istanbul')::date;
 IF NOT EXISTS(SELECT 1 FROM derslik.open_slots(ws,student) o WHERE o.starts_at=start_at) THEN
  IF NOT EXISTS(SELECT 1 FROM derslik.booking_packages(ws,student) p
   WHERE p.free>0 AND (p.expires_on IS NULL OR p.expires_on>=on_day)) THEN
   RAISE EXCEPTION 'No free credits' USING ERRCODE='P0001',HINT='credits';
  END IF;
  RAISE EXCEPTION 'Slot unavailable' USING ERRCODE='P0001',HINT='slot';
 END IF;
 SELECT p.id INTO pack FROM derslik.booking_packages(ws,student) p
  WHERE p.free>0 AND (p.expires_on IS NULL OR p.expires_on>=on_day)
  ORDER BY p.expires_on NULLS LAST,p.created_at,p.id LIMIT 1;
 PERFORM 1 FROM derslik.packages p WHERE p.workspace_id=ws AND p.id=pack FOR UPDATE;
 INSERT INTO derslik.lessons(workspace_id,student_id,package_id,topic,starts_at,ends_at,location,booked_by)
 VALUES(ws,student,pack,left(pupil.subject,120),start_at,
  start_at+make_interval(mins=>rules.duration_minutes),rules.location,derslik.actor_id())
 RETURNING * INTO created;
 INSERT INTO derslik.notifications(workspace_id,user_id,student_id,title,body,kind,target_id)
 SELECT ws,w.owner_id,student,'notice.lessonBooked',pupil.name,'LESSON',created.id
 FROM derslik.workspaces w WHERE w.id=ws;
 RETURN to_jsonb(created);
END $$;
--> statement-breakpoint
-- Öğrencinin kendi ayarladığı dersi iptali. Kilit sırası öğretmenin ders
-- işlemleriyle aynıdır (öğrenci satırı, ders). Kural sırası: ders yok ya da
-- başka öğrencinin ('notFound'), öğretmen planlamış ('notBooked'), planlı
-- değil ('state'), sürüm eski ('changed'), iptal süresi geçmiş ('deadline').
CREATE FUNCTION derslik.cancel_booking(ws uuid,student uuid,lesson uuid,expected_version int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE pupil derslik.students; target derslik.lessons; limit_hours int; cancelled derslik.lessons;
BEGIN
 IF NOT derslik.booking_student(ws,student) THEN
  RAISE EXCEPTION 'Booking unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO pupil FROM derslik.students s WHERE s.workspace_id=ws AND s.id=student FOR UPDATE;
 SELECT * INTO target FROM derslik.lessons l
  WHERE l.workspace_id=ws AND l.id=lesson AND l.student_id=student FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Lesson not found' USING ERRCODE='P0001',HINT='notFound';
 END IF;
 IF target.booked_by IS NULL THEN
  RAISE EXCEPTION 'Lesson not booked by the student' USING ERRCODE='P0001',HINT='notBooked';
 END IF;
 IF target.status<>'SCHEDULED' THEN
  RAISE EXCEPTION 'Lesson is not scheduled' USING ERRCODE='P0001',HINT='state';
 END IF;
 IF target.version<>expected_version THEN
  RAISE EXCEPTION 'Lesson changed' USING ERRCODE='P0001',HINT='changed';
 END IF;
 SELECT b.cancel_hours INTO limit_hours FROM derslik.booking_settings b WHERE b.workspace_id=ws;
 IF now()>target.starts_at-make_interval(hours=>COALESCE(limit_hours,0)) THEN
  RAISE EXCEPTION 'Cancellation deadline passed' USING ERRCODE='P0001',HINT='deadline';
 END IF;
 UPDATE derslik.lessons l SET status='CANCELLED',version=l.version+1
 WHERE l.workspace_id=ws AND l.id=lesson RETURNING * INTO cancelled;
 INSERT INTO derslik.notifications(workspace_id,user_id,student_id,title,body,kind,target_id)
 SELECT ws,w.owner_id,student,'notice.lessonCancelledByStudent',pupil.name,'LESSON',lesson
 FROM derslik.workspaces w WHERE w.id=ws;
 RETURN to_jsonb(cancelled);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION derslik.booking_student(uuid,uuid),derslik.booking_policy(uuid),
 derslik.booking_packages(uuid,uuid),derslik.open_slots(uuid,uuid),derslik.free_credits(uuid,uuid),
 derslik.book_lesson(uuid,uuid,timestamptz),derslik.cancel_booking(uuid,uuid,uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.booking_student(uuid,uuid),derslik.booking_policy(uuid),
 derslik.open_slots(uuid,uuid),derslik.free_credits(uuid,uuid),
 derslik.book_lesson(uuid,uuid,timestamptz),derslik.cancel_booking(uuid,uuid,uuid,int) TO derslik_app;
