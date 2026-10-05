-- PDF kaynakları özel materyal deposunda kalır; ders erişimi yalnızca ilişkilendirilmiş PDF'yi açar.
ALTER TABLE derslik.materials ADD CONSTRAINT materials_board_scope UNIQUE(workspace_id,student_id,id);
CREATE TABLE derslik.lesson_board_documents (
 workspace_id uuid NOT NULL,
 student_id uuid NOT NULL,
 lesson_id uuid NOT NULL,
 material_id uuid NOT NULL,
 page_count integer NOT NULL CHECK(page_count BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,lesson_id,material_id),
 UNIQUE(workspace_id,student_id,lesson_id,material_id),
 FOREIGN KEY(workspace_id,student_id,lesson_id) REFERENCES derslik.lesson_boards(workspace_id,student_id,lesson_id),
 FOREIGN KEY(workspace_id,student_id,material_id) REFERENCES derslik.materials(workspace_id,student_id,id)
);
ALTER TABLE derslik.lesson_board_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE derslik.lesson_board_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY lesson_document_read ON derslik.lesson_board_documents FOR SELECT
 USING(workspace_id=derslik.workspace_id() AND derslik.can_lesson_board(workspace_id,student_id,lesson_id));
CREATE POLICY lesson_document_insert ON derslik.lesson_board_documents FOR INSERT
 WITH CHECK(workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id) AND derslik.can_lesson_board(workspace_id,student_id,lesson_id,true)
 AND EXISTS(SELECT 1 FROM derslik.materials m WHERE m.workspace_id=lesson_board_documents.workspace_id AND m.student_id=lesson_board_documents.student_id
 AND m.id=lesson_board_documents.material_id AND m.purpose='RESOURCE' AND m.mime_type='application/pdf' AND m.status='READY' AND NOT m.delete_requested));
-- Silinmiş kaynakların ilişkileri bir sonraki eklemede tahta kilidi altında kaldırılır.
CREATE POLICY lesson_document_delete ON derslik.lesson_board_documents FOR DELETE
 USING(workspace_id=derslik.workspace_id() AND derslik.is_owner(workspace_id) AND derslik.can_lesson_board(workspace_id,student_id,lesson_id,true)
 AND EXISTS(SELECT 1 FROM derslik.materials m WHERE m.workspace_id=lesson_board_documents.workspace_id AND m.student_id=lesson_board_documents.student_id
 AND m.id=lesson_board_documents.material_id AND (m.status='DELETED' OR m.delete_requested)));
GRANT SELECT,INSERT,DELETE ON derslik.lesson_board_documents TO derslik_app;
CREATE POLICY lesson_pdf_read ON derslik.materials FOR SELECT
 USING(workspace_id=derslik.workspace_id() AND purpose='RESOURCE' AND mime_type='application/pdf' AND status='READY' AND NOT delete_requested
 AND EXISTS(SELECT 1 FROM derslik.lesson_board_documents d WHERE d.workspace_id=materials.workspace_id AND d.student_id=materials.student_id AND d.material_id=materials.id));
--> statement-breakpoint
ALTER TABLE derslik.lesson_boards ADD COLUMN document_id uuid;
ALTER TABLE derslik.lesson_boards ADD COLUMN page integer NOT NULL DEFAULT 0;
ALTER TABLE derslik.lesson_boards ADD CONSTRAINT lesson_board_page CHECK((document_id IS NULL AND page=0) OR (document_id IS NOT NULL AND page BETWEEN 1 AND 100));
ALTER TABLE derslik.lesson_boards ADD CONSTRAINT lesson_board_document_fk FOREIGN KEY(workspace_id,student_id,lesson_id,document_id)
 REFERENCES derslik.lesson_board_documents(workspace_id,student_id,lesson_id,material_id);
ALTER TABLE derslik.lesson_board_strokes ADD COLUMN document_id uuid;
ALTER TABLE derslik.lesson_board_strokes ADD COLUMN page integer NOT NULL DEFAULT 0;
ALTER TABLE derslik.lesson_board_strokes ADD COLUMN tool text NOT NULL DEFAULT 'pen';
ALTER TABLE derslik.lesson_board_strokes ADD COLUMN text text;
ALTER TABLE derslik.lesson_board_strokes ADD CONSTRAINT lesson_stroke_page CHECK((document_id IS NULL AND page=0) OR (document_id IS NOT NULL AND page BETWEEN 1 AND 100));
ALTER TABLE derslik.lesson_board_strokes ADD CONSTRAINT lesson_stroke_document_fk FOREIGN KEY(workspace_id,student_id,lesson_id,document_id)
 REFERENCES derslik.lesson_board_documents(workspace_id,student_id,lesson_id,material_id);
ALTER TABLE derslik.lesson_board_strokes ADD CONSTRAINT lesson_stroke_tool CHECK(tool IN ('pen','highlighter','line','rectangle','ellipse','note'));
ALTER TABLE derslik.lesson_board_strokes ADD CONSTRAINT lesson_stroke_shape CHECK(tool NOT IN ('line','rectangle','ellipse') OR jsonb_array_length(points)=2);
ALTER TABLE derslik.lesson_board_strokes ADD CONSTRAINT lesson_stroke_note CHECK((tool='note' AND jsonb_array_length(points)=1 AND text IS NOT NULL AND char_length(text) BETWEEN 1 AND 300) OR (tool<>'note' AND text IS NULL));
DROP POLICY lesson_stroke_insert ON derslik.lesson_board_strokes;
CREATE POLICY lesson_stroke_insert ON derslik.lesson_board_strokes FOR INSERT
 WITH CHECK(workspace_id=derslik.workspace_id() AND author_id=derslik.actor_id() AND derslik.can_lesson_board(workspace_id,student_id,lesson_id,true)
 AND EXISTS(SELECT 1 FROM derslik.lesson_boards b WHERE b.workspace_id=lesson_board_strokes.workspace_id AND b.lesson_id=lesson_board_strokes.lesson_id
 AND b.epoch=lesson_board_strokes.epoch AND b.document_id IS NOT DISTINCT FROM lesson_board_strokes.document_id AND b.page=lesson_board_strokes.page));
--> statement-breakpoint
-- Kaynak silinince öğrenci aynı revision ile eski PDF'de kalmasın; tahta verisi korunur.
CREATE FUNCTION derslik.invalidate_lesson_pdf() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,derslik AS $$
BEGIN
 IF (NEW.delete_requested AND NOT OLD.delete_requested) OR (NEW.status='DELETED' AND OLD.status<>'DELETED') THEN
  UPDATE derslik.lesson_boards b SET revision=revision+1,
   document_id=CASE WHEN b.document_id=NEW.id THEN NULL ELSE b.document_id END,
   page=CASE WHEN b.document_id=NEW.id THEN 0 ELSE b.page END
  WHERE b.workspace_id=NEW.workspace_id AND EXISTS(SELECT 1 FROM derslik.lesson_board_documents d
   WHERE d.workspace_id=b.workspace_id AND d.lesson_id=b.lesson_id AND d.material_id=NEW.id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION derslik.invalidate_lesson_pdf() FROM PUBLIC;
CREATE TRIGGER material_invalidates_lesson_pdf AFTER UPDATE OF status,delete_requested ON derslik.materials
 FOR EACH ROW EXECUTE FUNCTION derslik.invalidate_lesson_pdf();
