CREATE TABLE IF NOT EXISTS "DsmItemResponse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessionId" uuid NOT NULL,
	"itemId" varchar(16) NOT NULL,
	"score" integer NOT NULL,
	"ambiguity" integer NOT NULL,
	"evidenceQuotes" json DEFAULT '[]'::json NOT NULL,
	"confidence" real,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "DsmSession" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chatId" uuid NOT NULL,
	"sessionStatus" varchar DEFAULT 'active' NOT NULL,
	"diagnosticMode" varchar DEFAULT 'diagnostic' NOT NULL,
	"transcript" json DEFAULT '[]'::json NOT NULL,
	"symptomSummary" json DEFAULT '[]'::json NOT NULL,
	"riskFlags" json NOT NULL,
	"questionState" json NOT NULL,
	"sessionMeta" json NOT NULL,
	"completedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "DsmSession_chatId_unique" UNIQUE("chatId")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "DsmItemResponse" ADD CONSTRAINT "DsmItemResponse_sessionId_DsmSession_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."DsmSession"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "DsmSession" ADD CONSTRAINT "DsmSession_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."Chat"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
