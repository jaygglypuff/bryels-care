import { timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

/** UUIDv7 primary key generated in the application (ADR-009). */
export const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());

/** Standard audit columns (data-model §1). */
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Quantities in base units: numeric(18,6) (ADR-010). Money: numeric(18,4). */
export const QTY = { precision: 18, scale: 6 } as const;
export const MONEY = { precision: 18, scale: 4 } as const;
