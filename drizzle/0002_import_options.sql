ALTER TABLE "import_jobs" ADD COLUMN "sheets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;