-- Anlık mesajlaşma (WebSocket). Mesaj kaydedilince ve okundu bilgisi
-- ilerleyince veritabanı yalnızca yazışmanın kimliğini yayınlar (NOTIFY);
-- mesajın içeriği yayına çıkmaz. API alıcıları o anda message_recipients ile
-- bulur ve soketlerine "bu yazışma değişti" der; istemci mesajları her
-- zamanki REST uçlarından, aynı erişim kurallarıyla çeker.
-- `o`: yazan bağlantının application_name'i. Olayı kendi içinde zaten
-- dağıtan API kopyası kendi bildirimini atlar; birden fazla API kopyası varsa
-- diğerleri bu bildirimle öğrenir.
CREATE FUNCTION derslik.message_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='messages' THEN
  PERFORM pg_notify('derslik_messages',json_build_object(
   't','message','w',NEW.workspace_id,'l',NEW.link_id,
   'o',current_setting('application_name',true))::text);
 ELSE
  PERFORM pg_notify('derslik_messages',json_build_object(
   't','read','w',NEW.workspace_id,'l',NEW.link_id,'u',NEW.user_id,
   'o',current_setting('application_name',true))::text);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION derslik.message_event() FROM PUBLIC;
CREATE TRIGGER messages_event AFTER INSERT ON derslik.messages
 FOR EACH ROW EXECUTE FUNCTION derslik.message_event();
CREATE TRIGGER message_reads_event AFTER INSERT ON derslik.message_reads
 FOR EACH ROW EXECUTE FUNCTION derslik.message_event();
CREATE TRIGGER message_reads_event_update AFTER UPDATE ON derslik.message_reads
 FOR EACH ROW WHEN (OLD.read_at IS DISTINCT FROM NEW.read_at)
 EXECUTE FUNCTION derslik.message_event();
--> statement-breakpoint
-- Bir yazışmayı şu anda okuyabilen hesaplar (message_access ile aynı kurallar):
-- öğretmen her zaman; bağlantının hesabı, bağlantı etkin ve öğrenci
-- arşivlenmemişse; öğrenci yazışmasında paylaşımlara erişimi olan etkin
-- veliler. Erişimi kaldırılan kişi bir sonraki olaydan itibaren haber almaz.
CREATE FUNCTION derslik.message_recipients(link uuid)
RETURNS TABLE(user_id uuid,workspace_id uuid,student_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 WITH t AS (
  SELECT l.workspace_id,l.student_id,l.user_id,l.role,w.owner_id,
   l.revoked_at IS NULL AND s.active AS open
  FROM derslik.portal_links l
  JOIN derslik.workspaces w ON w.id=l.workspace_id
  JOIN derslik.students s ON s.workspace_id=l.workspace_id AND s.id=l.student_id
  WHERE l.id=link AND l.user_id<>w.owner_id
 )
 SELECT t.owner_id,t.workspace_id,t.student_id FROM t
 UNION
 SELECT t.user_id,t.workspace_id,t.student_id FROM t WHERE t.open
 UNION
 SELECT g.user_id,t.workspace_id,t.student_id FROM t
 JOIN derslik.portal_links g ON g.workspace_id=t.workspace_id AND g.student_id=t.student_id
  AND g.role='GUARDIAN' AND g.revoked_at IS NULL AND 'notes'=ANY(g.permissions)
 WHERE t.open AND t.role='STUDENT' AND g.user_id<>t.owner_id
$$;
REVOKE ALL ON FUNCTION derslik.message_recipients(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.message_recipients(uuid) TO derslik_app;
--> statement-breakpoint
-- Soket bileti: oturumlu kullanıcı REST ile 30 saniyelik, tek kullanımlık bir
-- bilet alır ve soketi onunla açar. Tarayıcı oturum belirtecini hiç görmez
-- (HttpOnly çerez); bilet adreste değil alt protokol başlığında gider.
-- Tabloda yalnızca biletin SHA-256 özeti durur. Uygulama rolü tabloya
-- erişemez; yalnızca aşağıdaki iki fonksiyonu çağırır.
CREATE TABLE derslik.socket_tickets (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX socket_tickets_user ON derslik.socket_tickets(user_id);
CREATE INDEX socket_tickets_expiry ON derslik.socket_tickets(expires_at);
ALTER TABLE derslik.socket_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.socket_tickets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON derslik.socket_tickets FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION derslik.issue_socket_ticket(ticket_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
BEGIN
 IF derslik.actor_id() IS NULL THEN
  RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';
 END IF;
 DELETE FROM derslik.socket_tickets WHERE expires_at<now();
 IF (SELECT count(*) FROM derslik.socket_tickets WHERE user_id=derslik.actor_id())>=20 THEN
  RAISE EXCEPTION 'Too many socket tickets' USING ERRCODE='P0001', HINT='ticket_limit';
 END IF;
 INSERT INTO derslik.socket_tickets(token_hash,user_id,expires_at)
 VALUES(ticket_hash,derslik.actor_id(),now()+interval '30 seconds');
END $$;
-- Bilet bir kez kullanılır: geçerliyse silinir ve sahibinin kimliği döner.
CREATE FUNCTION derslik.redeem_socket_ticket(ticket_hash text) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 DELETE FROM derslik.socket_tickets
 WHERE token_hash=ticket_hash AND expires_at>now()
 RETURNING user_id;
$$;
REVOKE ALL ON FUNCTION derslik.issue_socket_ticket(text),derslik.redeem_socket_ticket(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.issue_socket_ticket(text),derslik.redeem_socket_ticket(text) TO derslik_app;
