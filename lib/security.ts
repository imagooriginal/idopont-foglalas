import { createHash } from "node:crypto";
import { z } from "zod";

export const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "Érvénytelen UUID azonosító.",
  );

export const customBookingFieldDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().trim().min(1).max(80),
  type: z.literal("text"),
  required: z.boolean(),
});

export type CustomBookingFieldDefinition = z.infer<
  typeof customBookingFieldDefinitionSchema
>;

export const customBookingFieldDefinitionsListSchema = z
  .array(customBookingFieldDefinitionSchema)
  .max(20)
  .refine(
    (fields) => new Set(fields.map((field) => field.key)).size === fields.length,
    "A dinamikus mezőkulcsoknak egyedinek kell lenniük.",
  );

function stripControlCharacters(value: string) {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function sanitizeFieldString(value: string) {
  return stripControlCharacters(value).trim();
}

export const genericCustomFieldsSchema = z
  .record(
    z.string().regex(/^[a-z0-9_]{1,40}$/),
    z
      .string()
      .transform(stripControlCharacters)
      .pipe(
        z.string().trim().max(200, {
          message: "Egy dinamikus mező értéke legfeljebb 200 karakter lehet.",
        }),
      ),
  )
  .refine((obj) => Object.keys(obj).length <= 20, {
    message: "Legfeljebb 20 egyedi mező adható meg.",
  });

/**
 * Dynamically builds a strict Zod schema from a company's `custom_booking_fields` JSONB definition.
 * - Rejects any unknown field key not present in `definitions`
 * - Enforces `required: true` fields (`*`-prefixed) to be non-empty after trim
 * - Trims all values and enforces max 200 characters per field and max 20 fields per company
 */
export function buildCustomBookingFieldsSchema(
  definitions: CustomBookingFieldDefinition[],
) {
  const validDefinitions =
    customBookingFieldDefinitionsListSchema.parse(definitions);

  const shape: Record<string, z.ZodType<string | undefined>> = {};
  for (const field of validDefinitions) {
    const baseString = z
      .string()
      .transform(stripControlCharacters)
      .pipe(
        z.string().trim().max(200, {
          message: `A(z) "${field.label}" mező legfeljebb 200 karakter lehet.`,
        }),
      );

    if (field.required) {
      shape[field.key] = z
        .string()
        .transform(stripControlCharacters)
        .pipe(z.string().trim().min(1, "A mező kitöltése kötelező").max(200, {
          message: `A(z) "${field.label}" mező legfeljebb 200 karakter lehet.`,
        }));
    } else {
      shape[field.key] = baseString.optional();
    }
  }

  return z
    .object(shape)
    .strict()
    .transform((record) => {
      const cleaned: Record<string, string> = {};
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === "string" && value.length > 0) {
          cleaned[key] = value;
        }
      }
      return cleaned;
    });
}

export const lockRequestSchema = z.object({
  companyId: uuidSchema,
  serviceIds: z
    .array(uuidSchema)
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "A szolgáltatások nem ismétlődhetnek.",
    }),
  start: z
    .string()
    .refine((value) => Number.isFinite(new Date(value).getTime()), {
      message: "Érvénytelen kezdési időpont.",
    }),
  vehicleMake: z
    .string()
    .max(100)
    .transform(sanitizeFieldString)
    .optional(),
  vehicleModel: z
    .string()
    .max(100)
    .transform(sanitizeFieldString)
    .optional(),
  vehicleRegistration: z
    .string()
    .max(20)
    .transform(sanitizeFieldString)
    .optional(),
  customFields: genericCustomFieldsSchema.optional(),
});

export const confirmRequestSchema = z.object({
  lockToken: uuidSchema,
  name: z
    .string()
    .transform(sanitizeFieldString)
    .refine((val) => val.length >= 1 && val.length <= 200, {
      message: "Adj meg érvényes nevet.",
    }),
  email: z
    .string()
    .transform((val) => val.trim())
    .refine(
      (val) => val.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
      { message: "Adj meg érvényes e-mail-címet." },
    ),
  phone: z
    .string()
    .transform(sanitizeFieldString)
    .refine((val) => val.length <= 40, {
      message: "A telefonszám túl hosszú.",
    })
    .nullable()
    .optional(),
  privacyAccepted: z.literal(true),
});

export const sendOtpRequestSchema = z.object({
  lockToken: uuidSchema,
  email: z
    .string()
    .transform((val) => val.trim().toLowerCase())
    .refine(
      (val) => val.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
      { message: "Adj meg érvényes e-mail-címet." },
    ),
});

export const slotsQuerySchema = z.object({
  companySlug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i),
  serviceIds: z
    .array(uuidSchema)
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length),
  weekStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((weekStart) => {
      const parsedDay = new Date(`${weekStart}T00:00:00.000Z`);
      return (
        !Number.isNaN(parsedDay.getTime()) &&
        parsedDay.toISOString().slice(0, 10) === weekStart &&
        parsedDay.getUTCDay() === 1
      );
    }, "A hét kezdőnapja érvénytelen."),
});

export function hashIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function extractClientIdentifier(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ip = forwardedFor?.split(",")[0]?.trim() || realIp?.trim() || "";

  if (!ip) {
    return null;
  }

  return hashIdentifier(ip);
}

interface RateLimitEntry {
  timestamps: number[];
}

interface ActiveLockEntry {
  lockToken: string;
  expiresAt: number;
}

const MAX_SECURITY_STORE_ENTRIES = 5000;
const rateLimitStore = new Map<string, RateLimitEntry>();
const activeLocksByClient = new Map<string, ActiveLockEntry[]>();

function pruneRateLimitStore(cutoff: number) {
  if (rateLimitStore.size < MAX_SECURITY_STORE_ENTRIES) return;
  for (const [key, entry] of rateLimitStore.entries()) {
    const active = entry.timestamps.filter((ts) => ts > cutoff);
    if (active.length === 0) {
      rateLimitStore.delete(key);
    } else {
      rateLimitStore.set(key, { timestamps: active });
    }
  }
  while (rateLimitStore.size >= MAX_SECURITY_STORE_ENTRIES) {
    const oldestKey = rateLimitStore.keys().next().value;
    if (!oldestKey) break;
    rateLimitStore.delete(oldestKey);
  }
}

function pruneActiveLocksStore(now: number) {
  if (activeLocksByClient.size < MAX_SECURITY_STORE_ENTRIES) return;
  for (const [key, entries] of activeLocksByClient.entries()) {
    const active = entries.filter((entry) => entry.expiresAt > now);
    if (active.length === 0) {
      activeLocksByClient.delete(key);
    } else {
      activeLocksByClient.set(key, active);
    }
  }
  while (activeLocksByClient.size >= MAX_SECURITY_STORE_ENTRIES) {
    const oldestKey = activeLocksByClient.keys().next().value;
    if (!oldestKey) break;
    activeLocksByClient.delete(oldestKey);
  }
}

export function resetSecurityStateForTests() {
  rateLimitStore.clear();
  activeLocksByClient.clear();
}

export function checkRateLimit(
  scope: string,
  identifierHash: string,
  maxAttempts = 5,
  windowMs = 10 * 60 * 1000,
  now = Date.now(),
): { allowed: boolean; remaining: number } {
  const key = `${scope}:${identifierHash}`;
  const cutoff = now - windowMs;
  pruneRateLimitStore(cutoff);
  const existing = rateLimitStore.get(key)?.timestamps ?? [];
  const recent = existing.filter((timestamp) => timestamp > cutoff);

  if (recent.length >= maxAttempts) {
    rateLimitStore.set(key, { timestamps: recent });
    return { allowed: false, remaining: 0 };
  }

  recent.push(now);
  rateLimitStore.set(key, { timestamps: recent });
  return { allowed: true, remaining: Math.max(0, maxAttempts - recent.length) };
}

export function countActiveClientLocks(
  clientFingerprint: string,
  now = Date.now(),
): number {
  const existing = activeLocksByClient.get(clientFingerprint) ?? [];
  const active = existing.filter((entry) => entry.expiresAt > now);
  if (active.length !== existing.length) {
    if (active.length === 0) {
      activeLocksByClient.delete(clientFingerprint);
    } else {
      activeLocksByClient.set(clientFingerprint, active);
    }
  }
  return active.length;
}

export function registerActiveClientLock(
  clientFingerprint: string,
  lockToken: string,
  lockedUntilIso: string,
  now = Date.now(),
) {
  pruneActiveLocksStore(now);
  const expiresAt = new Date(lockedUntilIso).getTime();
  const validExpiry = Number.isFinite(expiresAt) ? expiresAt : now + 5 * 60 * 1000;
  const existing = (activeLocksByClient.get(clientFingerprint) ?? []).filter(
    (entry) => entry.expiresAt > now && entry.lockToken !== lockToken,
  );
  existing.push({ lockToken, expiresAt: validExpiry });
  activeLocksByClient.set(clientFingerprint, existing);
}

export function releaseActiveClientLock(lockToken: string) {
  for (const [fingerprint, entries] of activeLocksByClient.entries()) {
    const filtered = entries.filter((entry) => entry.lockToken !== lockToken);
    if (filtered.length !== entries.length) {
      activeLocksByClient.set(fingerprint, filtered);
    }
  }
}
