CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"character_id" text,
	"character_name" text,
	"is_crossover" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New session' NOT NULL,
	"mode" text DEFAULT 'solo' NOT NULL,
	"character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_crossover" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companion_memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"emotional_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resonance_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "user_id" SET DEFAULT '';--> statement-breakpoint
CREATE INDEX "chat_messages_session_idx" ON "chat_messages" USING btree ("user_id","session_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_character_idx" ON "chat_messages" USING btree ("user_id","character_id");--> statement-breakpoint
CREATE INDEX "chat_sessions_user_idx" ON "chat_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_sessions_updated_idx" ON "chat_sessions" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "companion_memories_user_character_uq" ON "companion_memories" USING btree ("user_id","character_id");--> statement-breakpoint
CREATE INDEX "companion_memories_user_idx" ON "companion_memories" USING btree ("user_id");