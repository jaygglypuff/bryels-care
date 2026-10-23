import "server-only";
import { hash, verify } from "@node-rs/argon2";

/** argon2id with OWASP-recommended parameters (docs/security.md §3). */
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => hash(plain, OPTS);
export const verifyPassword = (hashed: string, plain: string) => verify(hashed, plain).catch(() => false);
