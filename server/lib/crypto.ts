import crypto from 'node:crypto';
import { serverConfig } from '../config.js';

const algorithm = 'aes-256-gcm';
const key = crypto.createHash('sha256').update(serverConfig.sessionSecret).digest();

export function encrypt(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, ciphertext]
    .map((chunk) => chunk.toString('base64url'))
    .join('.');
}

export function decrypt<T>(value: string): T | null {
  const [ivPart, authTagPart, ciphertextPart] = value.split('.');
  if (!ivPart || !authTagPart || !ciphertextPart) return null;

  try {
    const decipher = crypto.createDecipheriv(
      algorithm,
      key,
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTagPart, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]);

    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
