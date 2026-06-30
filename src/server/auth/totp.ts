import { generateSecret, generateURI, verifySync } from 'otplib';
import { createHash, randomBytes } from 'crypto';

const ISSUER = 'BeastMode Portal';

export function generateTotpSecret(): string {
  return generateSecret({ length: 20 });
}

export function generateTotpUri(secret: string, email: string): string {
  return generateURI({ secret, label: email, issuer: ISSUER });
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    const result = verifySync({ token, secret });
    return result.valid;
  } catch {
    return false;
  }
}

export function generateBackupCodes(): { raw: string[]; hashed: string[] } {
  const raw = Array.from({ length: 8 }, () => {
    const bytes = randomBytes(5);
    const hex = bytes.toString('hex').toUpperCase();
    return `${hex.slice(0, 5)}-${hex.slice(5)}`;
  });
  return { raw, hashed: raw.map(hashBackupCode) };
}

export function hashBackupCode(code: string): string {
  const normalised = code.replace(/-/g, '').toUpperCase();
  return createHash('sha256').update(normalised).digest('hex');
}

/** Returns the remaining backup codes after consuming one. Returns null if the code is invalid. */
export function consumeBackupCode(
  code: string,
  storedHashes: string[],
): string[] | null {
  const h = hashBackupCode(code);
  const idx = storedHashes.indexOf(h);
  if (idx === -1) return null;
  const remaining = [...storedHashes];
  remaining.splice(idx, 1);
  return remaining;
}
