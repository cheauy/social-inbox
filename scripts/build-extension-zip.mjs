import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";

/*
 * The Chrome Web Store upload, built from the folder rather than by hand.
 *
 * Zipping `tenh-extension` in Explorer produces an archive with the folder
 * inside it, and the store rejects that with a message about a missing
 * manifest which sounds like the manifest is wrong. This writes the paths the
 * store expects -- manifest.json at the root -- and leaves out the things a
 * reviewer should not have to read: the README, the store notes, editor
 * leftovers.
 *
 * Written against the zip format directly because a build that needs an npm
 * install before it can ship a release is a build that fails on the day it is
 * needed.
 */

const SOURCE = "tenh-extension";
const OUT_DIR = "dist";

const SKIP = new Set([
  "README.md",
  "STORE.md",
  ".DS_Store",
  "Thumbs.db",
]);

async function collect(directory) {
  const found = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;

    const full = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...(await collect(full)));
      continue;
    }

    found.push(full);
  }

  return found;
}

/* PKZIP wants MS-DOS date and time fields, which is 1980 with a two-second
   clock. Deterministic here, so two builds of one version match. */
const DOS_TIME = 0;
const DOS_DATE = 33; /* 1980-01-01 */

function crc32(buffer) {
  const table = new Int32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value;
  }

  let crc = -1;

  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);

  return (crc ^ -1) >>> 0;
}

function localHeader(name, data, compressed) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30);

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, nameBytes]);
}

function centralHeader(name, data, compressed, offset) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(46);

  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc32(data), 16);
  header.writeUInt32LE(compressed.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);

  return Buffer.concat([header, nameBytes]);
}

async function main() {
  const manifest = JSON.parse(
    await readFile(join(SOURCE, "manifest.json"), "utf8"),
  );

  await mkdir(OUT_DIR, { recursive: true });

  const target = join(OUT_DIR, `tenh-v1-${manifest.version}.zip`);
  const files = (await collect(SOURCE)).sort();

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    /* Forward slashes, and relative to the extension folder: manifest.json has
       to sit at the root of the archive. */
    const name = relative(SOURCE, file).split("\\").join("/");
    const data = await readFile(file);
    const compressed = deflateRawSync(data, { level: 9 });

    const local = localHeader(name, data, compressed);

    locals.push(local, compressed);
    centrals.push(centralHeader(name, data, compressed, offset));

    offset += local.length + compressed.length;
  }

  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  await mkdir(dirname(target), { recursive: true });

  await new Promise((resolve, reject) => {
    const stream = createWriteStream(target);

    stream.on("error", reject);
    stream.on("finish", resolve);
    stream.write(Buffer.concat([...locals, central, end]));
    stream.end();
  });

  const { size } = await stat(target);

  console.log(`${target} — ${files.length} files, ${(size / 1024).toFixed(1)} kB`);
  console.log(`${manifest.name} ${manifest.version}`);

  for (const file of files) console.log(`  ${relative(SOURCE, file)}`);
}

await main();
