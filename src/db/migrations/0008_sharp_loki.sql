CREATE TABLE "sales_order_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artwork_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid,
	"product_id" uuid NOT NULL,
	"artwork_code" text NOT NULL,
	"version_label" text NOT NULL,
	"description" text,
	"file_attachment_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_by" uuid,
	"retired_at" timestamp with time zone,
	CONSTRAINT "artwork_versions_status_ck" CHECK ("artwork_versions"."status" in ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"province" text,
	"postal_code" text,
	"country" char(2) DEFAULT 'PH' NOT NULL,
	"contact_name" text,
	"phone" text,
	"is_default_ship_to" boolean DEFAULT false NOT NULL,
	"is_default_bill_to" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_default_live_ck" CHECK ("customer_addresses"."deleted_at" is null or not ("customer_addresses"."is_default_ship_to" or "customer_addresses"."is_default_bill_to"))
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role_label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"anonymised_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_item_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_item_code" text NOT NULL,
	"customer_description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_requirements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid,
	"requirement_kind" text NOT NULL,
	"value_numeric" numeric(18, 6),
	"value_text" text,
	"artwork_version_id" uuid,
	"label_template_id" uuid,
	"version_no" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"supersedes_id" uuid,
	"change_summary" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_requirements_kind_ck" CHECK ("customer_requirements"."requirement_kind" in ('label_artwork','carton_count','coa_required','moq','lead_time','packaging','document','lot_age_max_days','min_remaining_shelf_life_days','full_shipment_required','shipping_marks','other')),
	CONSTRAINT "customer_requirements_status_ck" CHECK ("customer_requirements"."status" in ('draft','pending_approval','approved','rejected','retired')),
	CONSTRAINT "customer_requirements_sod_ck" CHECK ("customer_requirements"."approved_by" is null or "customer_requirements"."approved_by" is distinct from "customer_requirements"."submitted_by"),
	CONSTRAINT "customer_requirements_dates_ck" CHECK ("customer_requirements"."effective_to" is null or "customer_requirements"."effective_to" > "customer_requirements"."effective_from"),
	CONSTRAINT "customer_requirements_value_ck" CHECK (num_nonnulls("customer_requirements"."value_numeric", "customer_requirements"."value_text", "customer_requirements"."artwork_version_id", "customer_requirements"."label_template_id") >= 1)
);
--> statement-breakpoint
CREATE TABLE "price_list_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"price_list_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"min_qty_units" numeric(18, 6) DEFAULT '0' NOT NULL,
	"unit_amount" numeric(18, 4) NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	CONSTRAINT "price_list_lines_amount_ck" CHECK ("price_list_lines"."unit_amount" >= 0 and "price_list_lines"."min_qty_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"party_kind" text NOT NULL,
	"customer_id" uuid,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"version_no" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"supersedes_id" uuid,
	"change_summary" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_kind_ck" CHECK (("price_lists"."party_kind" = 'customer' and "price_lists"."customer_id" is not null) or ("price_lists"."party_kind" = 'general' and "price_lists"."customer_id" is null)),
	CONSTRAINT "price_lists_status_ck" CHECK ("price_lists"."status" in ('draft','pending_approval','approved','rejected','retired')),
	CONSTRAINT "price_lists_sod_ck" CHECK ("price_lists"."approved_by" is null or "price_lists"."approved_by" is distinct from "price_lists"."submitted_by"),
	CONSTRAINT "price_lists_dates_ck" CHECK ("price_lists"."effective_to" is null or "price_lists"."effective_to" > "price_lists"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quote_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_units" numeric(18, 6) NOT NULL,
	"list_unit_amount" numeric(18, 4),
	"unit_amount" numeric(18, 4) NOT NULL,
	"discount_pct" numeric(9, 4) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"price_list_line_id" uuid,
	CONSTRAINT "quote_lines_qty_ck" CHECK ("quote_lines"."qty_units" > 0 and "quote_lines"."unit_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"quote_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"ship_to_address_id" uuid,
	"price_list_id" uuid,
	"valid_until" date NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"subtotal_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"max_discount_pct" numeric(9, 4) DEFAULT '0' NOT NULL,
	"notes_customer" text,
	"notes_internal" text,
	"converted_sales_order_id" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_status_ck" CHECK ("quotes"."status" in ('draft','pending_approval','sent','accepted','rejected','expired','converted','voided')),
	CONSTRAINT "quotes_converted_ck" CHECK (("quotes"."status" = 'converted') = ("quotes"."converted_sales_order_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "approval_rules" DROP CONSTRAINT "ck_approval_rules_document_type";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "segment" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "currency" text DEFAULT 'PHP' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "payment_terms_days" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_limit_amount" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "default_lead_time_days" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tax_identifier" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "notes_internal" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "price_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "list_unit_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "price_list_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "price_list_line_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "discount_pct" numeric(9, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "requirement_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "min_remaining_shelf_life_days" integer;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "customer_item_code" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "ship_to_address_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "bill_to_address_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "ship_to_text" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "currency" char(3) DEFAULT 'PHP' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "subtotal_amount" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "total_amount" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "credit_check_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "approval_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "approval_basis" jsonb;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "warnings" jsonb;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "approval_note" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "status_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_state_transitions" ADD CONSTRAINT "sales_order_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_state_transitions" ADD CONSTRAINT "sales_order_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_state_transitions" ADD CONSTRAINT "sales_order_state_transitions_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_state_transitions" ADD CONSTRAINT "sales_order_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_file_attachment_id_file_attachments_id_fk" FOREIGN KEY ("file_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_retired_by_users_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_item_codes" ADD CONSTRAINT "customer_item_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_item_codes" ADD CONSTRAINT "customer_item_codes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_item_codes" ADD CONSTRAINT "customer_item_codes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_item_codes" ADD CONSTRAINT "customer_item_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_artwork_version_id_artwork_versions_id_fk" FOREIGN KEY ("artwork_version_id") REFERENCES "public"."artwork_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_label_template_id_label_templates_id_fk" FOREIGN KEY ("label_template_id") REFERENCES "public"."label_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_supersedes_id_customer_requirements_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."customer_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_supersedes_id_price_lists_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_price_list_line_id_price_list_lines_id_fk" FOREIGN KEY ("price_list_line_id") REFERENCES "public"."price_list_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_ship_to_address_id_customer_addresses_id_fk" FOREIGN KEY ("ship_to_address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "so_transitions_order_idx" ON "sales_order_state_transitions" USING btree ("sales_order_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artwork_versions_code_uq" ON "artwork_versions" USING btree ("organization_id","artwork_code","version_label");--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_default_ship_uq" ON "customer_addresses" USING btree ("customer_id") WHERE "customer_addresses"."is_default_ship_to" and "customer_addresses"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_default_bill_uq" ON "customer_addresses" USING btree ("customer_id") WHERE "customer_addresses"."is_default_bill_to" and "customer_addresses"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "customer_contacts_customer_idx" ON "customer_contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_contacts_primary_uq" ON "customer_contacts" USING btree ("customer_id") WHERE "customer_contacts"."is_primary" and "customer_contacts"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_item_codes_product_uq" ON "customer_item_codes" USING btree ("customer_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_item_codes_code_uq" ON "customer_item_codes" USING btree ("customer_id","customer_item_code");--> statement-breakpoint
CREATE INDEX "customer_requirements_customer_idx" ON "customer_requirements" USING btree ("customer_id","requirement_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_requirements_version_uq" ON "customer_requirements" USING btree ("customer_id",coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid),"requirement_kind","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_requirements_one_open_uq" ON "customer_requirements" USING btree ("customer_id",coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid),"requirement_kind") WHERE "customer_requirements"."status" in ('draft', 'pending_approval');--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_lines_uq" ON "price_list_lines" USING btree ("price_list_id","product_id","min_qty_units");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_code_version_uq" ON "price_lists" USING btree ("organization_id","code","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_one_open_uq" ON "price_lists" USING btree ("organization_id","code") WHERE "price_lists"."status" in ('draft', 'pending_approval');--> statement-breakpoint
CREATE INDEX "price_lists_customer_idx" ON "price_lists" USING btree ("customer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_lines_line_uq" ON "quote_lines" USING btree ("quote_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_org_number_uq" ON "quotes" USING btree ("organization_id","quote_number");--> statement-breakpoint
CREATE INDEX "quotes_site_status_idx" ON "quotes" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "quotes_customer_idx" ON "quotes" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_price_list_line_id_price_list_lines_id_fk" FOREIGN KEY ("price_list_line_id") REFERENCES "public"."price_list_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_ship_to_address_id_customer_addresses_id_fk" FOREIGN KEY ("ship_to_address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_bill_to_address_id_customer_addresses_id_fk" FOREIGN KEY ("bill_to_address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "so_customer_idx" ON "sales_orders" USING btree ("customer_id","status");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_status_ck" CHECK ("customers"."status" in ('prospect', 'active', 'on_hold', 'inactive'));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_credit_ck" CHECK (coalesce("customers"."credit_limit_amount", 0) >= 0 and coalesce("customers"."payment_terms_days", 0) >= 0 and coalesce("customers"."default_lead_time_days", 0) >= 0);--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "so_status_ck" CHECK ("sales_orders"."status" in ('draft','submitted','pending_approval','confirmed','allocated','picking','packed','partially_shipped','shipped','invoiced','closed','cancelled'));--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "so_credit_check_ck" CHECK ("sales_orders"."credit_check_status" in ('not_required','pending','passed','failed','overridden'));--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "ck_approval_rules_document_type" CHECK ("approval_rules"."document_type" in ('purchase_request','purchase_order','sales_order','quote','stock_adjustment','stock_count_variance','expense_claim','invoice','supplier_bill','credit_note','payment_record','dispense_exception','over_shipment','formula_revision','routing_revision','routing_revision_sequencing','work_instruction_revision','inspection_plan','disposition_conditional_release','recall_case','batch_reopen','work_order_release','leave_request','overtime_request','payroll_period','period_lock_unlock','setting_change_request','retention_action','supplier_return','equipment_override','payroll_period_reopen','price_list'));