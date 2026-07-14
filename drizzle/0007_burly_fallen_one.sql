CREATE TABLE "confirmation"."roster_member_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roster_member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_member_access_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "confirmation"."roster_member_access" ADD CONSTRAINT "roster_member_access_roster_member_id_roster_members_id_fk" FOREIGN KEY ("roster_member_id") REFERENCES "confirmation"."roster_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_member_access_member_idx" ON "confirmation"."roster_member_access" USING btree ("roster_member_id");