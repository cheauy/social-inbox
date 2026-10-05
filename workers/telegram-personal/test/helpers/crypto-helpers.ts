import { randomBytes } from "node:crypto";

export {
  generateSealKeyPair,
  privateKeyFromPem,
  publicKeyFromRaw,
  seal,
  sealAad,
  type LoginInputKind,
} from "../../src/crypto.ts";

export function randomKek() {
  return randomBytes(32);
}
