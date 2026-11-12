-- A report-document block can carry content that depends on the test outcome: field and setting
-- values overridden for a passed and for a failed run. They live BESIDE the common values_json /
-- settings_json, which a run without a pronounced verdict prints. NULL means the author has not
-- touched the outcome content, so the template variant's outcome defaults apply; '{}' means the
-- author switched it off. Existing rows get NULL. Additive only.
ALTER TABLE "report_blocks" ADD COLUMN "outcome_json" jsonb;