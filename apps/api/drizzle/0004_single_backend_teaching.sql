-- Preserve the teaching capabilities previously held in the Site database.
ALTER TABLE derslik.assignments
 ADD COLUMN status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','COMPLETED','CANCELLED')),
 ADD COLUMN version integer NOT NULL DEFAULT 0 CHECK(version >= 0);
ALTER TABLE derslik.assignments ALTER COLUMN due_on DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE derslik.materials ALTER COLUMN assignment_id DROP NOT NULL;
ALTER TABLE derslik.materials DROP CONSTRAINT materials_purpose_check;
ALTER TABLE derslik.materials ADD CONSTRAINT materials_purpose_check CHECK(purpose IN ('ASSIGNMENT','SUBMISSION','RESOURCE'));
ALTER TABLE derslik.materials ADD CONSTRAINT materials_assignment_required CHECK(purpose = 'RESOURCE' OR assignment_id IS NOT NULL);
ALTER TABLE derslik.materials ADD CONSTRAINT materials_student_fk FOREIGN KEY(workspace_id,student_id) REFERENCES derslik.students(workspace_id,id);
ALTER TABLE derslik.materials ADD COLUMN delete_requested boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE derslik.videos ALTER COLUMN lesson_id DROP NOT NULL;
ALTER TABLE derslik.videos ADD CONSTRAINT videos_student_fk FOREIGN KEY(workspace_id,student_id) REFERENCES derslik.students(workspace_id,id);
