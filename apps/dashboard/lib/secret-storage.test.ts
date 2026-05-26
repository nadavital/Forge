import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptSecretFromStorage,
  encryptSecretForStorage,
  isSecretEncryptionConfigured
} from "./security/secret-storage.ts";

test("secret storage encrypts and decrypts values when an encryption key is configured", () => {
  const env = { FORGE_TOKEN_ENCRYPTION_KEY: "test-encryption-key" };
  const encrypted = encryptSecretForStorage("ghu_secret", env);

  assert.notEqual(encrypted, "ghu_secret");
  assert.match(String(encrypted), /^enc:v1:/);
  assert.equal(decryptSecretFromStorage(encrypted, env), "ghu_secret");
});

test("secret storage leaves local values readable when no encryption key is configured", () => {
  assert.equal(isSecretEncryptionConfigured({}), false);
  assert.equal(encryptSecretForStorage("local-token", {}), "local-token");
  assert.equal(decryptSecretFromStorage("local-token", {}), "local-token");
});

test("encrypted secrets cannot be decrypted without the storage key", () => {
  const encrypted = encryptSecretForStorage("ghu_secret", { FORGE_TOKEN_ENCRYPTION_KEY: "test-key" });

  assert.throws(
    () => decryptSecretFromStorage(encrypted, {}),
    /FORGE_TOKEN_ENCRYPTION_KEY/
  );
});
