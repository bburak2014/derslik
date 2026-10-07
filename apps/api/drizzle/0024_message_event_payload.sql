-- Yeni mesaj sokete içeriğiyle gider: alıcı mesajı REST'ten yeniden çekmez,
-- gönderen de kendi mesajını tanır. Bildirim (NOTIFY) yine içerik taşımaz,
-- yalnızca mesajın kimliğini (`m`) ekler; NOTIFY'ın 8000 baytlık sınırına
-- 2000 karakterlik bir mesaj sığmayabilir. Olayı dağıtan API mesajı ve
-- alıcılarını message_delivery ile tek sorguda okur.
CREATE OR REPLACE FUNCTION derslik.message_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='messages' THEN
  PERFORM pg_notify('derslik_messages',json_build_object(
   't','message','w',NEW.workspace_id,'l',NEW.link_id,'m',NEW.id,
   'o',current_setting('application_name',true))::text);
 ELSE
  PERFORM pg_notify('derslik_messages',json_build_object(
   't','read','w',NEW.workspace_id,'l',NEW.link_id,'u',NEW.user_id,
   'o',current_setting('application_name',true))::text);
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
-- Mesajı o anda okuyabilen her hesap için bir satır: mesaj o hesabın REST'te
-- göreceği biçimde (message_thread gibi). Gönderen bağlantıya göre yazılır;
-- `mine` alıcının kendisinin yazıp yazmadığıdır. Alıcılar message_recipients
-- ile bulunur; öğretmen dışındakiler REST'in portal kapısındaki gibi
-- (can_student) Dersler izni olan etkin bir bağlantı da ister. Davetler bu
-- izni hep içerir, ama kural veritabanında zorunlu değildir; içerik REST'in
-- vermeyeceği kimseye gitmez.
CREATE FUNCTION derslik.message_delivery(msg uuid)
RETURNS TABLE(user_id uuid,workspace_id uuid,student_id uuid,link_id uuid,
 id uuid,sender_role text,mine boolean,body text,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT r.user_id,r.workspace_id,r.student_id,m.link_id,m.id,
  CASE WHEN m.sender_id=w.owner_id THEN 'OWNER' WHEN m.sender_id=l.user_id THEN l.role ELSE 'OTHER' END,
  m.sender_id=r.user_id,m.body,m.created_at
 FROM derslik.messages m
 JOIN derslik.portal_links l ON l.id=m.link_id
 JOIN derslik.workspaces w ON w.id=l.workspace_id
 CROSS JOIN LATERAL derslik.message_recipients(m.link_id) r
 WHERE m.id=msg AND (r.user_id=w.owner_id OR EXISTS(
  SELECT 1 FROM derslik.portal_links p
  WHERE p.workspace_id=r.workspace_id AND p.student_id=r.student_id
   AND p.user_id=r.user_id AND p.revoked_at IS NULL AND 'lessons'=ANY(p.permissions)))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION derslik.message_delivery(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION derslik.message_delivery(uuid) TO derslik_app;
