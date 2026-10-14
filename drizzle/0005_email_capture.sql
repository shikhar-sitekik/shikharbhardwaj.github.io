CREATE TABLE "email_capture_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"captured_by_id" uuid,
	"provider" text NOT NULL,
	"message_id" text NOT NULL,
	"direction" text NOT NULL,
	"subject" text NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text,
	"to_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"cc_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"snippet" text,
	"body_text" text,
	"attachment_count" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_capture_tokens" ADD CONSTRAINT "email_capture_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_capture_tokens" ADD CONSTRAINT "email_capture_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_captured_by_id_users_id_fk" FOREIGN KEY ("captured_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_capture_user_uq" ON "email_capture_tokens" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_capture_hash_uq" ON "email_capture_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_msgid_uq" ON "email_messages" USING btree ("tenant_id","message_id");--> statement-breakpoint
CREATE INDEX "email_messages_user_idx" ON "email_messages" USING btree ("tenant_id","captured_by_id","created_at");