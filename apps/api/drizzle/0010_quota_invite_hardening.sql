-- Dosya kotası: yüklemesi hiç tamamlanmayan (PENDING) kayıtlar kotayı sonsuza
-- dek tutuyordu; bağlı bir öğrenci hiçbir dosya yüklemeden 20 x 10 MB ayırıp
-- öğretmenin kotasını doldurabiliyordu. Artık:
--  * 3 saatten eski PENDING kayıt kotaya sayılmaz (Supabase'in imzalı yükleme
--    bağlantısı 2 saatte düşer; API bu kayıtları da tamamlatmaz),
--  * bir hesabın aynı anda en fazla 5 bekleyen yüklemesi olabilir.
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
 SELECT COALESCE(sum(size_bytes),0) INTO used FROM derslik.materials WHERE workspace_id=ws AND status<>'DELETED'
  AND (status<>'PENDING' OR created_at>now()-interval '3 hours');
 IF used+bytes>maximum THEN RAISE EXCEPTION 'File storage quota exceeded' USING ERRCODE='23514'; END IF;
END $$;
REVOKE ALL ON FUNCTION derslik.reserve_material_quota(uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.reserve_material_quota(uuid,uuid,bigint) TO derslik_app;
--> statement-breakpoint
-- Davet kabulü: e-posta NULL gelirse `inv.email<>lower(NULL)` NULL olur ve
-- kontrol sessizce atlanırdı. API e-postayı hep verir; bu savunma katmanı.
CREATE OR REPLACE FUNCTION derslik.accept_invitation(invite_hash text,verified_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
DECLARE inv derslik.invitations; link_id uuid; BEGIN
 SELECT * INTO inv FROM derslik.invitations WHERE token_hash=invite_hash FOR UPDATE;
 IF inv.id IS NULL OR verified_email IS NULL OR inv.email IS DISTINCT FROM lower(verified_email) OR inv.expires_at<now() OR inv.revoked_at IS NOT NULL OR inv.accepted_at IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM derslik.students WHERE id=inv.student_id AND workspace_id=inv.workspace_id AND active) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='23514'; END IF;
 INSERT INTO derslik.users(id) VALUES(derslik.actor_id()) ON CONFLICT DO NOTHING;
 INSERT INTO derslik.portal_links(workspace_id,student_id,user_id,role,permissions) VALUES(inv.workspace_id,inv.student_id,derslik.actor_id(),inv.role,inv.permissions)
 ON CONFLICT(workspace_id,student_id,user_id,role) DO UPDATE SET permissions=EXCLUDED.permissions,revoked_at=NULL RETURNING id INTO link_id;
 INSERT INTO derslik.memberships(workspace_id,user_id,role) VALUES(inv.workspace_id,derslik.actor_id(),inv.role) ON CONFLICT(workspace_id,user_id,role) DO UPDATE SET active=true;
 UPDATE derslik.invitations SET accepted_at=now() WHERE id=inv.id;
 RETURN jsonb_build_object('id',link_id,'workspaceId',inv.workspace_id,'studentId',inv.student_id,'role',inv.role);
END $$;
REVOKE ALL ON FUNCTION derslik.accept_invitation(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.accept_invitation(text,text) TO derslik_app;
--> statement-breakpoint
-- Davet bağlantısı artık tekrar yanıtında saklanmıyor; eski kayıtlardaki açık
-- token'lar da silinir (veritabanı dökümü sızarsa geçerli bağlantı sızmasın).
UPDATE derslik.api_commands SET response=response #- '{data,url}' WHERE action='invitation.create' AND response ? 'data';
