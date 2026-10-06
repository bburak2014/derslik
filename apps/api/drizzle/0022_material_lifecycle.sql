-- Dosya yaşam döngüsü ve kota. Supabase'in imzalı yükleme bağlantısı
-- verildiği andan iki saat geçerlidir; uygulamadaki kayıt silinse de geri
-- alınamaz. Önceden silme kaydı DELETED yapıp kotayı hemen bırakıyordu: aynı
-- bağlantıyla yola yeniden yüklenen nesne kotaya sayılmıyor, depoda kalıyordu.
-- Süresi dolan PENDING kayıt da yüklenmiş nesnesi silinmeden kotadan düşüyordu.
--  * upload_window_ends: bu kayda verilen son yükleme bağlantısının bittiği an.
--    API bağlantıyı istemeden önce yazar.
--  * purged_at: nesne, bütün bağlantılar bittikten sonra sağlayıcıdan silindi.
--    Bu andan sonra yola bir şey yüklenemez; kota ancak o zaman boşalır.
ALTER TABLE derslik.materials ADD COLUMN upload_window_ends timestamptz;
--> statement-breakpoint
ALTER TABLE derslik.materials ADD COLUMN purged_at timestamptz;
--> statement-breakpoint
CREATE INDEX materials_unpurged ON derslik.materials(workspace_id) WHERE purged_at IS NULL;
--> statement-breakpoint
CREATE INDEX materials_cleanup ON derslik.materials(created_at)
 WHERE purged_at IS NULL AND (status<>'READY' OR delete_requested);
--> statement-breakpoint
-- Kota, sağlayıcıda nesnesi olabilecek her kaydı sayar: hazır, bekleyen
-- (süresi dolmuş olsa da temizlenene kadar) ve bağlantısı açık ya da henüz
-- temizlenmemiş silinmiş kayıt. Bekleyen yükleme sınırı (5) değişmedi.
CREATE OR REPLACE FUNCTION derslik.reserve_material_quota(ws uuid,student uuid,bytes bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE maximum bigint; used bigint; pending int;
BEGIN
 IF bytes<1 OR bytes>10485760 OR NOT derslik.can_student(ws,student,'assignments',true) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 INSERT INTO derslik.workspace_limits(workspace_id) VALUES(ws) ON CONFLICT DO NOTHING;
 SELECT material_bytes INTO maximum FROM derslik.workspace_limits WHERE workspace_id=ws FOR UPDATE;
 SELECT count(*) INTO pending FROM derslik.materials WHERE workspace_id=ws AND user_id=derslik.actor_id()
  AND status='PENDING' AND NOT delete_requested AND created_at>now()-interval '3 hours';
 IF pending>=5 THEN RAISE EXCEPTION 'Too many pending uploads' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(size_bytes),0) INTO used FROM derslik.materials WHERE workspace_id=ws AND purged_at IS NULL;
 IF used+bytes>maximum THEN RAISE EXCEPTION 'File storage quota exceeded' USING ERRCODE='23514'; END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION derslik.reserve_material_quota(uuid,uuid,bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION derslik.reserve_material_quota(uuid,uuid,bigint) TO derslik_app;
--> statement-breakpoint
-- Temizlenecek nesneler: silinen, silinmesi istenen ve tamamlama süresi (3 saat)
-- dolmuş bekleyen kayıtlar; yalnızca bütün yükleme bağlantıları bittiyse. Böyle
-- bir kayda yeni bağlantı verilmez, koşul bir kez sağlanınca hep sağlanır.
CREATE FUNCTION derslik.material_cleanup_due(batch int)
RETURNS TABLE(id uuid, object_key text, checked_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT m.id, m.object_key, now() FROM derslik.materials m
 WHERE m.purged_at IS NULL
  AND (m.status='DELETED' OR m.delete_requested OR (m.status='PENDING' AND m.created_at<=now()-interval '3 hours'))
  AND (m.upload_window_ends IS NULL OR m.upload_window_ends<=now())
 ORDER BY m.created_at, m.id
 LIMIT least(greatest(batch,1),500)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION derslik.material_cleanup_due(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION derslik.material_cleanup_due(int) TO derslik_app;
--> statement-breakpoint
-- Sağlayıcı silmesi `checked` anından sonra başladı: o anda bitmiş bağlantılar
-- yola artık yazamaz. Kayıt silinmiş olarak işaretlenir, kota boşalır.
CREATE FUNCTION derslik.material_cleanup_done(ids uuid[], checked timestamptz) RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 WITH purged AS (
  UPDATE derslik.materials SET status='DELETED', delete_requested=true, purged_at=now()
  WHERE id=ANY(ids) AND purged_at IS NULL
   AND (status='DELETED' OR delete_requested OR (status='PENDING' AND created_at<=checked-interval '3 hours'))
   AND (upload_window_ends IS NULL OR upload_window_ends<=checked)
  RETURNING 1)
 SELECT count(*)::int FROM purged
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION derslik.material_cleanup_done(uuid[],timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION derslik.material_cleanup_done(uuid[],timestamptz) TO derslik_app;
