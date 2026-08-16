import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

/** `promisify` não cobre a sobrecarga com opções — wrapper explícito. */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/**
 * Hash de senha com scrypt (`node:crypto`) — algoritmo de derivação lenta,
 * com salt por usuário. Nunca MD5/SHA simples e nunca texto puro.
 *
 * Formato armazenado: `scrypt$N$r$p$<salt base64>$<hash base64>`, para que
 * os parâmetros possam evoluir sem invalidar hashes antigos.
 */
const KEY_LENGTH = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/** Comparação em tempo constante — nunca `===` sobre o hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltBase64, hashBase64] = parts;
  const salt = Buffer.from(saltBase64!, "base64");
  const expected = Buffer.from(hashBase64!, "base64");

  const derived = await scryptAsync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
