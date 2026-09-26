-- Bir hesap (bir e-posta) ya öğretmen ya öğrencidir. Hesabın ikinci rolü
-- kazanacağı her yerde (çalışma alanı açmak, öğrenci davetini kabul etmek,
-- ders isteği göndermek ve kabul edilmek) API bu fonksiyonlarla kontrol eder.
-- Bugün iki rolü birden olan hesaplara dokunulmaz. Veli bağlantıları kapsam dışı.
CREATE FUNCTION derslik.is_teacher_account(uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT EXISTS(SELECT 1 FROM derslik.workspaces WHERE owner_id=uid);
$$;
CREATE FUNCTION derslik.is_student_account(uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT EXISTS(SELECT 1 FROM derslik.portal_links WHERE user_id=uid AND role='STUDENT' AND revoked_at IS NULL);
$$;
-- Davet kendi e-postasına gönderilmiş kişi, kabul etmeden önce davetin rolünü
-- öğrenir. E-posta tutmazsa NULL döner ve accept_invitation "yanlış hesap"
-- hatasını verir.
CREATE FUNCTION derslik.invitation_role(invite_hash text,verified_email text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
 SELECT role FROM derslik.invitations WHERE token_hash=invite_hash AND email=lower(verified_email);
$$;
REVOKE ALL ON FUNCTION derslik.is_teacher_account(uuid),derslik.is_student_account(uuid),derslik.invitation_role(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derslik.is_teacher_account(uuid),derslik.is_student_account(uuid),derslik.invitation_role(text,text) TO derslik_app;
