-- Each notification names the record it is about, so tapping it opens that place.
ALTER TABLE derslik.notifications
 ADD COLUMN kind text CHECK(kind IN ('ASSIGNMENT','SUBMISSION','REVIEW','VIDEO','QUESTION','ANSWER','SUMMARY')),
 ADD COLUMN target_id uuid;
