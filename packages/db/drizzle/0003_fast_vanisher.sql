CREATE TYPE "public"."execution_status" AS ENUM('executing', 'succeeded', 'failed', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."pricing_model" AS ENUM('per_call', 'metered');--> statement-breakpoint
CREATE TYPE "public"."provider_status" AS ENUM('pending', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."tool_interface" AS ENUM('http', 'mcp');--> statement-breakpoint
CREATE TYPE "public"."tool_status" AS ENUM('active', 'deprecated', 'disabled');--> statement-breakpoint
CREATE TABLE "tool_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"policy_decision_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"request_payload" jsonb NOT NULL,
	"response_payload" jsonb,
	"price_paid" numeric(38, 18),
	"tx_hash" text,
	"status" "execution_status" DEFAULT 'executing' NOT NULL,
	"latency_ms" numeric(20, 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tool_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"identity_ref" uuid,
	"contact_email" text,
	"payout_wallet_address" text NOT NULL,
	"payout_chain" text DEFAULT 'sepolia' NOT NULL,
	"provider_token_hash" text NOT NULL,
	"status" "provider_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general' NOT NULL,
	"price" numeric(38, 18) DEFAULT '0' NOT NULL,
	"price_token" text DEFAULT 'USDC' NOT NULL,
	"pricing_model" "pricing_model" DEFAULT 'per_call' NOT NULL,
	"interface_type" "tool_interface" DEFAULT 'http' NOT NULL,
	"endpoint_url" text NOT NULL,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_schema" jsonb,
	"status" "tool_status" DEFAULT 'active' NOT NULL,
	"success_rate" numeric(5, 2),
	"avg_latency_ms" numeric(20, 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_providers" ADD CONSTRAINT "tool_providers_identity_ref_agents_id_fk" FOREIGN KEY ("identity_ref") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_provider_id_tool_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."tool_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tool_exec_agent" ON "tool_executions" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_providers_status" ON "tool_providers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tools_provider" ON "tools" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_tools_status_category" ON "tools" USING btree ("status","category");