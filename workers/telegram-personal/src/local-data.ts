import { closeSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync, writeSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Each session gets its own directory; ids are validated so a path can never escape dataDir. */
export function sessionDirectory(dataDir: string, sessionId: string) {
  if (!SESSION_ID.test(sessionId)) throw new Error("Invalid session id.");
  const root = resolve(dataDir, "sessions");
  const dir = resolve(root, sessionId);
  if (!dir.startsWith(root + sep)) throw new Error("Session path escapes the data directory.");
  return { dir, database: join(dir, "db"), files: join(dir, "files"), lock: join(dir, ".tenh-owner.lock") };
}

export function ensureSessionDirectory(dataDir: string, sessionId: string) {
  const paths = sessionDirectory(dataDir, sessionId);
  mkdirSync(paths.database, { recursive: true, mode: 0o700 });
  mkdirSync(paths.files, { recursive: true, mode: 0o700 });
  return paths;
}

export function removeSessionDirectory(dataDir: string, sessionId: string) {
  rmSync(sessionDirectory(dataDir, sessionId).dir, { recursive: true, force: true });
}

export class LockHeldError extends Error {}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Local guard in addition to the database lease: refuses to open a session
 * directory another live process on this host holds (e.g. an overlapping
 * deploy). TDLib also locks its own database files.
 */
export function acquireDirectoryLock(lockPath: string, owner: { workerId: string; epoch: number }) {
  const body = JSON.stringify({ ...owner, pid: process.pid });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      writeSync(fd, body);
      closeSync(fd);
      return () => {
        try {
          const current = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
          if (current.pid === process.pid) unlinkSync(lockPath);
        } catch {
          /* already gone */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let holder: { pid?: number } = {};
      try {
        holder = JSON.parse(readFileSync(lockPath, "utf8"));
      } catch {
        /* unreadable lock: treat as stale */
      }
      if (holder.pid && holder.pid !== process.pid && processAlive(holder.pid)) {
        throw new LockHeldError("Session directory is held by another live process.");
      }
      unlinkSync(lockPath); // stale lock from a crashed process; the DB lease already fenced it
    }
  }
  throw new LockHeldError("Could not acquire session directory lock.");
}
