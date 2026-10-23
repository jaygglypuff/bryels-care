import { bigint, boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";

/**
 * Metadata of an uploaded file. The bytes live in the storage backend (local disk in development,
 * the private S3-compatible bucket in staging and production, ADR-014) under an opaque key
 * `org/<org-uuid>/<attachment-uuid>`; the original file name is kept only here (docs/security.md §4.6).
 * Attachments are never hard-deleted: voiding sets deleted_* and keeps the object for retention.
 */
export const fileAttachments = pgTable(
  "file_attachments",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    /** local | s3: the backend that holds the object (so a later switch does not orphan old files). */
    storageDriver: text("storage_driver").notNull(),
    bucketKey: text("bucket_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    /** Singular table name of the owning record, e.g. goods_receipt, goods_receipt_line, inventory_lot. */
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    attachmentKind: text("attachment_kind").notNull(),
    isSensitive: boolean("is_sensitive").notNull().default(false),
    /** pending | clean | blocked | failed. Antivirus scanning is deferred (A-SEC-17); files stay pending. */
    virusScanStatus: text("virus_scan_status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id),
    deleteReason: text("delete_reason"),
  },
  (t) => [
    uniqueIndex("uq_file_attachments_bucket_key").on(t.bucketKey),
    uniqueIndex("uq_file_attachments_org_idem").on(t.organizationId, t.idempotencyKey),
    index("ix_file_attachments_entity").on(t.entityType, t.entityId),
    check("ck_file_attachments_driver", sql`${t.storageDriver} in ('local','s3')`),
    check(
      "ck_file_attachments_kind",
      sql`${t.attachmentKind} in ('coa','sds','specification','certificate','photo','signature','paper_record_page','legacy_document','template_test_page','import','export','report','backup_manifest','archive','product_image','artwork','other')`,
    ),
    check("ck_file_attachments_scan", sql`${t.virusScanStatus} in ('pending','clean','blocked','failed')`),
    check("ck_file_attachments_size", sql`${t.sizeBytes} > 0`),
    check("ck_file_attachments_deleted", sql`(${t.deletedAt} is null) = (${t.deletedBy} is null)`),
  ],
);
