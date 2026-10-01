-- Öğrencinin boş saatten ders ayarlaması (1/2): öğretmen ayarları. Öğretmen
-- haftalık boş saatlerini, kapalı günlerini ve kurallarını girer. Tablolar
-- yalnızca öğretmene açıktır; öğrenci bunlara 0018'deki fonksiyonlarla ulaşır.
CREATE TABLE derslik.booking_settings (
 workspace_id uuid PRIMARY KEY REFERENCES derslik.workspaces(id),
 enabled boolean NOT NULL DEFAULT false,
 duration_minutes int NOT NULL DEFAULT 60 CHECK(duration_minutes BETWEEN 15 AND 180 AND duration_minutes%5=0),
 notice_hours int NOT NULL DEFAULT 12 CHECK(notice_hours BETWEEN 0 AND 168),
 cancel_hours int NOT NULL DEFAULT 24 CHECK(cancel_hours BETWEEN 0 AND 168),
 location text NOT NULL DEFAULT '' CHECK(char_length(location)<=100),
 version int NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Haftanın günü ISO'dur (1 = Pazartesi); saatler İstanbul saatiyle gün
-- başından dakikadır. Aynı gündeki aralıklar çakışamaz.
CREATE TABLE derslik.availability_windows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES derslik.booking_settings(workspace_id),
 weekday smallint NOT NULL CHECK(weekday BETWEEN 1 AND 7),
 start_minute smallint NOT NULL CHECK(start_minute BETWEEN 0 AND 1410 AND start_minute%30=0),
 end_minute smallint NOT NULL CHECK(end_minute BETWEEN 30 AND 1440 AND end_minute%30=0),
 CHECK(end_minute>start_minute),
 CONSTRAINT availability_no_overlap EXCLUDE USING gist(workspace_id WITH =,weekday WITH =,int4range(start_minute,end_minute) WITH &&)
);
-- Kapalı günler; iki uç da dahildir.
CREATE TABLE derslik.availability_blocks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES derslik.booking_settings(workspace_id),
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 CHECK(ends_on>=starts_on)
);
CREATE INDEX availability_blocks_workspace ON derslik.availability_blocks(workspace_id,ends_on);
-- Dersi ayarlayan öğrenci hesabı; boşsa dersi öğretmen oluşturmuştur.
ALTER TABLE derslik.lessons ADD COLUMN booked_by uuid REFERENCES derslik.users(id);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['booking_settings','availability_windows','availability_blocks'] LOOP
  EXECUTE format('ALTER TABLE derslik.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE derslik.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_all ON derslik.%I FOR ALL USING (workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id)) WITH CHECK (workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id))',t);
 END LOOP;
END $$;
REVOKE ALL ON derslik.booking_settings,derslik.availability_windows,derslik.availability_blocks FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON derslik.booking_settings TO derslik_app;
GRANT SELECT,INSERT,DELETE ON derslik.availability_windows,derslik.availability_blocks TO derslik_app;
