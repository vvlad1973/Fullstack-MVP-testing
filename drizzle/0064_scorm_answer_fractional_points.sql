-- A question's points in an attempt can be a SHARE of its price: a partial answer of a graded
-- question and a simulation run arrive as a number in 0..1 from live telemetry and from an
-- imported LMS export alike. In an integer column such a row failed the whole import batch,
-- and rounding would have turned 0.75 into the full point. integer -> double precision is
-- lossless: every stored value keeps its meaning.
ALTER TABLE "scorm_answers" ALTER COLUMN "points" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "scorm_answers" ALTER COLUMN "max_points" SET DATA TYPE double precision;