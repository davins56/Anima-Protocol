CREATE TABLE "memory_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"fact_id" text NOT NULL,
	"text" text NOT NULL,
	"memory_type" text DEFAULT 'unknown' NOT NULL,
	"embedding" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text DEFAULT 'hash-bow-v1' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proactive_message_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"frequency_hours" integer DEFAULT 24 NOT NULL,
	"last_sent_at" timestamp,
	"next_message_at" timestamp,
	"last_session_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploaded_images" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"content_type" text NOT NULL,
	"data_base64" text NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "memory_embeddings_user_char_fact_uq" ON "memory_embeddings" USING btree ("user_id","character_id","fact_id");--> statement-breakpoint
CREATE INDEX "memory_embeddings_user_char_idx" ON "memory_embeddings" USING btree ("user_id","character_id");--> statement-breakpoint
CREATE INDEX "proactive_message_preferences_due_idx" ON "proactive_message_preferences" USING btree ("enabled","next_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uploaded_images_user_idx" ON "uploaded_images" USING btree ("user_id");