-- Öğrencinin boş saatten ders ayarlaması: uç uca aralıklar. Aynı günün uç uca
-- aralıkları (15:00–19:00 ve 19:00–21:00) tek aralık sayılır; sınırdan geçen
-- ders (60 dakikalık derste 18:30) de önerilir. Yalnızca aralıkların
-- birleştirilmesi değişir; book_lesson boş saati bu fonksiyondan denetler.
-- Önümüzdeki 28 günün (bugün dahil) boş ders başlangıçları. Başlangıçlar
-- birleşik aralığın başından 30 dakikada birdir ve dersin tamamı aralığa
-- sığar. Kapalı günler, en az ne kadar önce kuralı, öğretmenin iptal edilmemiş
-- bütün dersleri ve öğrencinin o günü kapsayan boştaki hakkı denetlenir.
-- Sabitler packages/contracts/src/booking.ts ile aynı olmalı.
CREATE OR REPLACE FUNCTION derslik.open_slots(ws uuid,student uuid)
RETURNS TABLE(starts_at timestamptz,ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 WITH rules AS (
  SELECT b.duration_minutes,b.notice_hours FROM derslik.booking_settings b
  WHERE b.workspace_id=ws AND b.enabled AND derslik.booking_student(ws,student)
 ), credit AS (
  SELECT p.expires_on FROM derslik.booking_packages(ws,student) p WHERE p.free>0
 ), days AS (
  SELECT (now() AT TIME ZONE 'Europe/Istanbul')::date+i AS on_day FROM generate_series(0,27) i
 ), spans AS (
  SELECT g.weekday,lower(s) AS start_minute,upper(s) AS end_minute
  FROM (SELECT w.weekday,range_agg(int4range(w.start_minute,w.end_minute)) AS joined
   FROM derslik.availability_windows w WHERE w.workspace_id=ws GROUP BY w.weekday) g
  CROSS JOIN LATERAL unnest(g.joined) s
 ), candidates AS (
  SELECT d.on_day,r.duration_minutes,r.notice_hours,
   (d.on_day+make_interval(mins=>m)) AT TIME ZONE 'Europe/Istanbul' AS start_at
  FROM rules r CROSS JOIN days d
  JOIN spans w ON w.weekday=extract(isodow FROM d.on_day)
  CROSS JOIN LATERAL generate_series(w.start_minute,w.end_minute-r.duration_minutes,30) m
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
