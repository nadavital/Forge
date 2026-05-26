import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "enc:v1";

type Env = Partial<Record<string, string | undefined>>;

export function isSecretEncryptionConfigured(env: Env = process.env): boolean {
  return Boolean(clean(env.FORGE_TOKEN_ENCRYPTION_KEY));
}

export function encryptSecretForStorage(value: string | null | undefined, env: Env = process.env): string | null {
  if (!value) return null;
  if (value.startsWith(`${PREFIX}:`)) return value;
  const key = encryptionKey(env);
  if (!key) return value;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

export function decryptSecretFromStorage(value: string | null | undefined, env: Env = process.env): string | null {
  if (!value) return null;
  if (!value.startsWith(`${PREFIX}:`)) return value;

  const key = encryptionKey(env);
  if (!key) {
    throw new Error("FORGE_TOKEN_ENCRYPTION_KEY is required to decrypt stored OAuth tokens.");
  }

  const [, version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Stored secret has an unsupported format.");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function encryptionKey(env: Env): Buffer | null {
  const value = clean(env.FORGE_TOKEN_ENCRYPTION_KEY);
  if (!value) return null;
  return createHash("sha256").update(value).digest();
}

function clean(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
