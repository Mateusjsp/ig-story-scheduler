import crypto from "node:crypto";

// Cifragem simétrica dos tokens guardados (AES-256-GCM).
// Formato: base64( iv[12] | tag[16] | ciphertext ). A chave vem de TOKEN_ENC_KEY
// (qualquer string) reduzida a 32 bytes via SHA-256 — o serviço Python espelha isso.
function key(): Buffer {
  const secret = process.env.TOKEN_ENC_KEY;
  if (!secret) throw new Error("TOKEN_ENC_KEY ausente.");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptToken(blob: string): string {
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
