ALTER TABLE "DsmItemResponse"
ADD COLUMN IF NOT EXISTS "evidence" jsonb;

COMMENT ON COLUMN "DsmItemResponse"."evidence" IS
'Structured evidence spans: {type, messageIndex, spans[], strength, summary}';
