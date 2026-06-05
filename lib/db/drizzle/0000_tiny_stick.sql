CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity_name" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_entities_user_entity_id_uq" ON "user_entities" USING btree ("user_id","entity_name","entity_id");--> statement-breakpoint
CREATE INDEX "user_entities_user_entity_idx" ON "user_entities" USING btree ("user_id","entity_name");--> statement-breakpoint
CREATE INDEX "user_entities_created_idx" ON "user_entities" USING btree ("user_id","entity_name",(case when (data ->> 'created_date') ~ '^-?[0-9]+([.][0-9]+)?$' then (data ->> 'created_date')::numeric end) desc nulls last,((data ->> 'created_date') collate "C") desc nulls last);--> statement-breakpoint
CREATE INDEX "user_entities_updated_idx" ON "user_entities" USING btree ("user_id","entity_name",(case when (data ->> 'updated_date') ~ '^-?[0-9]+([.][0-9]+)?$' then (data ->> 'updated_date')::numeric end) desc nulls last,((data ->> 'updated_date') collate "C") desc nulls last);--> statement-breakpoint
CREATE INDEX "user_entities_session_seq_idx" ON "user_entities" USING btree ("user_id","entity_name",(data ->> 'session_id'),((data ->> 'seq')::numeric));--> statement-breakpoint
CREATE INDEX "user_entities_title_trgm_idx" ON "user_entities" USING gin ((data ->> 'title') gin_trgm_ops);