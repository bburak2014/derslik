-- Davet isteği aynı anahtarla tekrar gelirse (ilk yanıt öğretmene ulaşmadı)
-- açık bağlantı saklanmadığı için yeni bir bağlantı üretilir. Önceden bu
-- bağlantı ilkinin yerine yazılıyordu; ilk bağlantı e-postayla alıcıya gitmiş
-- olabileceğinden e-postadaki davet geçersiz kalıyordu. Artık tekrarın
-- bağlantısı ayrı tutulur, ikisi de aynı daveti açar. Davet yine tek kullanımlık.
ALTER TABLE derslik.invitations ADD COLUMN replay_token_hash text UNIQUE;
--> statement-breakpoint
-- Tekrar bağlantısını davetin asıl belirtecine çevirir; kabul fonksiyonları
-- asıl belirteçle çalışmaya devam eder.
CREATE FUNCTION derslik.invitation_token(invite_hash text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT COALESCE((SELECT token_hash FROM derslik.invitations WHERE replay_token_hash=invite_hash), invite_hash)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION derslik.invitation_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION derslik.invitation_token(text) TO derslik_app;
