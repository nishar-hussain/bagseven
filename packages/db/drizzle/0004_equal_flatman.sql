CREATE TYPE "public"."mandate_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."refusal_bound" AS ENUM('window', 'lifetime', 'per_purchase', 'per_seller', 'depth', 'vault');--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"operator_address" text NOT NULL,
	"budget_per_window" numeric(38, 18) NOT NULL,
	"window_seconds" bigint NOT NULL,
	"lifetime_cap" numeric(38, 18) NOT NULL,
	"per_purchase_limit" numeric(38, 18) NOT NULL,
	"per_seller_limit_bps" integer NOT NULL,
	"max_depth" integer NOT NULL,
	"chain" text DEFAULT 'sepolia' NOT NULL,
	"contract_address" text,
	"signature" text NOT NULL,
	"status" "mandate_status" DEFAULT 'active' NOT NULL,
	"superseded_at" timestamp with time zone,
	"window_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window_spent" numeric(38, 18) DEFAULT '0' NOT NULL,
	"lifetime_spent" numeric(38, 18) DEFAULT '0' NOT NULL,
	"seller_spent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refusals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"seller" text,
	"category" text,
	"chain" text DEFAULT 'sepolia' NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"violated_bound" "refusal_bound" NOT NULL,
	"reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"root_agent_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"contract_address" text,
	"chain" text DEFAULT 'sepolia' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "mandate_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "share_of_parent_bps" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refusals" ADD CONSTRAINT "refusals_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refusals" ADD CONSTRAINT "refusals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_root_agent_id_agents_id_fk" FOREIGN KEY ("root_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mandates_agent" ON "mandates" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_mandates_status" ON "mandates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mandate_agent_active" ON "mandates" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "idx_refusals_agent_created" ON "refusals" USING btree ("agent_id","requested_at");--> statement-breakpoint
CREATE INDEX "idx_refusals_mandate" ON "refusals" USING btree ("mandate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vault_mandate" ON "vaults" USING btree ("mandate_id");