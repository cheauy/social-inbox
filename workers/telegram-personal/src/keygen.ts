import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { generateSealKeyPair } from "./crypto.ts";

/*
 * Operator tool, run on the worker host (never in chat or CI):
 *   node src/keygen.ts /secure/path/seal-private.pem
 * Writes the X25519 seal private key (0600) and prints only PUBLIC values:
 * the seal public key for the web app. Generate the KEK separately with
 *   node src/keygen.ts --kek
 * and store it directly in the worker's secret manager.
 */
const target = process.argv[2];

if (target === "--kek") {
  process.stderr.write("Store this value only in the worker secret store as TELEGRAM_PERSONAL_KEK.\n");
  process.stdout.write(randomBytes(32).toString("base64") + "\n");
} else if (!target) {
  process.stderr.write("Usage: node src/keygen.ts <private-key-output.pem> | --kek\n");
  process.exit(2);
} else if (existsSync(target)) {
  process.stderr.write("Refusing to overwrite an existing key file.\n");
  process.exit(2);
} else {
  const pair = generateSealKeyPair();
  writeFileSync(target, pair.privateKeyPem, { mode: 0o600, flag: "wx" });
  process.stdout.write(`TELEGRAM_PERSONAL_SEAL_PUBLIC_KEY=${pair.publicKeyBase64}\n`);
}
