import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const VERSION_PREFIX = "v1";
const ALGORITHM = "aes-256-cbc";

// Hardcoded key material — provides obfuscation-level protection against
// accidental token exposure (browsing files, git commits).
// Does NOT protect against determined attackers with access to the binary.
const CURRENT_KEY_MATERIAL = "linear-v1-token-encryption-key";

// Precomputed sha256 of the v0 key material kept as a hex literal so the
// original key string itself never appears in source. Tokens stored under
// the v0 key are decrypted opportunistically; re-saving rewrites them with
// the current key.
const V0_KEY_HEX =
  "b6bf0281f5dec2e49fd2dbe672187731a4c3e66b0182b3b0edcc404cae6cfa86";

function deriveKey(keyMaterial: string): Buffer {
  return createHash("sha256").update(keyMaterial).digest();
}

export function encryptToken(token: string): string {
  const key = deriveKey(CURRENT_KEY_MATERIAL);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  // Store as version:iv:ciphertext, all hex-encoded except version
  return `${VERSION_PREFIX}:${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(encrypted: string): string {
  const parts = encrypted.split(":");

  // Support unversioned legacy format (iv:ciphertext)
  if (parts.length === 2 && parts[0] && parts[1]) {
    return decryptV1(parts[0], parts[1]);
  }

  // Versioned format (version:iv:ciphertext)
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    if (parts[0] !== VERSION_PREFIX) {
      throw new Error(`Unsupported token encryption version: ${parts[0]}`);
    }
    return decryptV1(parts[1], parts[2]);
  }

  throw new Error("Invalid encrypted token format");
}

function decryptV1(ivHex: string, ciphertextHex: string): string {
  const iv = Buffer.from(ivHex, "hex");
  if (iv.length !== 16) {
    throw new Error("Invalid encrypted token: corrupted IV");
  }
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const candidates: Buffer[] = [
    deriveKey(CURRENT_KEY_MATERIAL),
    Buffer.from(V0_KEY_HEX, "hex"),
  ];

  let firstError: unknown;
  for (const key of candidates) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return decrypted.toString("utf8");
    } catch (error) {
      firstError ??= error;
    }
  }

  throw firstError;
}
