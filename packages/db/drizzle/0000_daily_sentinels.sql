CREATE TYPE "public"."agent_status" AS ENUM('pending', 'active', 'suspended', 'retired');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."guardian_type" AS ENUM('human', 'organization');--> statement-breakpoint
CREATE TYPE "public"."kyb_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('daily', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."policy_decision" AS ENUM('allow', 'deny', 'pending_approval');--> statement-breakpoint
CREATE TYPE "public"."custody_type" AS ENUM('mpc', 'hsm', 'smart-account', 'dev');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('held', 'committed', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."wallet_status" AS ENUM('active', 'frozen', 'swept');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('agent', 'provider', 'platform', 'guardian');--> statement-breakpoint
CREATE TYPE "public"."ledger_side" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."action_type" AS ENUM('tool_execution', 'data_purchase', 'agent_payment', 'wallet_sweep');--> statement-breakpoint
CREATE TYPE "public"."counterparty_type" AS ENUM('tool_provider', 'data_provider', 'agent', 'guardian');--> statement-breakpoint
CREATE TABLE "agent_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"parent_agent_id" uuid,
	"display_name" text NOT NULL,
	"status" "agent_status" DEFAULT 'pending' NOT NULL,
	"current_version_id" uuid,
	"reputation_score" numeric(6, 2) DEFAULT '50.00' NOT NULL,
	"api_key_hash" text NOT NULL,
	"public_key_pem" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardian_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"requested_action" jsonb NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "guardian_type" NOT NULL,
	"org_id" uuid,
	"contact_email_encrypted" text,
	"approval_webhook_url" text,
	"approval_channel" text DEFAULT 'webhook' NOT NULL,
	"guardian_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"kyb_status" "kyb_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"daily_budget" numeric(38, 18) NOT NULL,
	"monthly_budget" numeric(38, 18),
	"max_transaction" numeric(38, 18) NOT NULL,
	"allowed_chains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_data_offers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"human_approval_threshold" numeric(38, 18),
	"delegation_rules" jsonb,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"policy_version" integer NOT NULL,
	"requested_action" jsonb NOT NULL,
	"decision" "policy_decision" NOT NULL,
	"reason" text,
	"decision_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_checks_decision_id_unique" UNIQUE("decision_id")
);
--> statement-breakpoint
CREATE TABLE "spend_counters" (
	"agent_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"period_type" "period_type" NOT NULL,
	"category" text,
	"spent_amount" numeric(38, 18) DEFAULT '0' NOT NULL,
	CONSTRAINT "spend_counters_agent_id_period_key_period_type_category_pk" PRIMARY KEY("agent_id","period_key","period_type","category")
);
--> statement-breakpoint
CREATE TABLE "balances" (
	"wallet_id" uuid NOT NULL,
	"token" text NOT NULL,
	"amount" numeric(38, 18) DEFAULT '0' NOT NULL,
	"reserved_amount" numeric(38, 18) DEFAULT '0' NOT NULL,
	"last_reconciled_at" timestamp with time zone,
	CONSTRAINT "balances_wallet_id_token_pk" PRIMARY KEY("wallet_id","token")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"token" text NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"policy_decision_id" uuid NOT NULL,
	"counterparty_id" uuid,
	"counterparty_type" text,
	"status" "reservation_status" DEFAULT 'held' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"tx_hash" text,
	"chain" text NOT NULL,
	"status" "settlement_status" DEFAULT 'pending' NOT NULL,
	"gas_used" numeric(20, 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"address" text NOT NULL,
	"custody_type" "custody_type" NOT NULL,
	"smart_account_impl_version" text,
	"status" "wallet_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_id" uuid NOT NULL,
	"account_type" "account_type" NOT NULL,
	"account_id" uuid NOT NULL,
	"side" "ledger_side" NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"token" text NOT NULL,
	"chain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_agent_id" uuid NOT NULL,
	"counterparty_id" uuid,
	"counterparty_type" "counterparty_type",
	"action_type" "action_type" NOT NULL,
	"amount" numeric(38, 18),
	"token" text,
	"tx_hash" text,
	"proof_ref" text NOT NULL,
	"proof_hash" text NOT NULL,
	"prev_hash" text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_capabilities" ADD CONSTRAINT "agent_capabilities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_parent_agent_id_agents_id_fk" FOREIGN KEY ("parent_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_approvals" ADD CONSTRAINT "guardian_approvals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_capability" ON "agent_capabilities" USING btree ("agent_id","capability");--> statement-breakpoint
CREATE INDEX "idx_agents_owner_org" ON "agents" USING btree ("owner_org_id");--> statement-breakpoint
CREATE INDEX "idx_agents_parent" ON "agents" USING btree ("parent_agent_id");--> statement-breakpoint
CREATE INDEX "idx_agents_status" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_guardian_approvals_agent_status" ON "guardian_approvals" USING btree ("agent_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_policy_agent_version" ON "policies" USING btree ("agent_id","version");--> statement-breakpoint
CREATE INDEX "idx_policy_checks_agent_created" ON "policy_checks" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_reservations_wallet_status" ON "reservations" USING btree ("wallet_id","status");--> statement-breakpoint
CREATE INDEX "idx_settlements_reservation" ON "settlements" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wallet_agent_chain" ON "wallets" USING btree ("agent_id","chain");--> statement-breakpoint
CREATE INDEX "idx_ledger_tx" ON "ledger_entries" USING btree ("tx_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_account" ON "ledger_entries" USING btree ("account_id","token");--> statement-breakpoint
CREATE INDEX "idx_receipts_actor_created" ON "receipts" USING btree ("actor_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_outbox_unpublished" ON "outbox_events" USING btree ("published_at","created_at");