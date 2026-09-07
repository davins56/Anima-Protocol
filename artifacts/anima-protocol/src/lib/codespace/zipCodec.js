// Minimal ZIP (store + deflate) codec for Codespace imports.
// Built so tests can mint archives without a dependency, and the browser can
// unpack a typical "Download ZIP" from GitHub / a folder compressor.

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concatBytes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function encodeUtf8(text) {
  return new TextEncoder().encode(String(text));
}

// Build an uncompressed (STORE) zip. Used by tests and as a fallback writer.
export function buildStoreZip(files = []) {
  const encoderParts = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = encodeUtf8(file.path);
    const data = typeof file.content === "string"
      ? encodeUtf8(file.content)
      : file.content instanceof Uint8Array
        ? file.content
        : encodeUtf8("");
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    encoderParts.push(local, data);
    const localOffset = offset;
    offset += local.length + data.length;

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, localOffset, true);
    central.set(name, 46);
    centrals.push(central);
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of centrals) {
    encoderParts.push(c);
    cdSize += c.length;
    offset += c.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  encoderParts.push(eocd);

  return concatBytes(encoderParts).buffer;
}

function findEocd(view) {
  const len = view.byteLength;
  const min = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= min; i--) {
    if (view.getUint32(i, true) !== EOCD_SIG) continue;
    const commentLen = view.getUint16(i + 20, true);
    if (i + 22 + commentLen === len) return i;
  }
  throw new Error("Not a zip archive — missing end-of-central-directory.");
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot inflate compressed zip entries. Upload the folder instead.");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeName(bytes, utf8) {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  // CP437 fallback: treat as latin1 so tests with ASCII still work.
  return new TextDecoder("latin1").decode(bytes);
}

// Default uncompressed budget matches Import / Pull archive ceiling (50MB).
// Callers that pass limits.maxZipBytes override this; the default exists so a
// leftover unpack site cannot reject a valid 50MB Import zip.
export const DEFAULT_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

// Unpack a zip ArrayBuffer into { path, bytes }[] (files only; dirs skipped).
export async function unzipToEntries(buffer, {
  maxUncompressedBytes = DEFAULT_MAX_UNCOMPRESSED_BYTES,
  skipPath,
} = {}) {
  if (!buffer || !(buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(buffer)) {
    throw new Error("Zip data is missing.");
  }
  const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const view = new DataView(ab);
  if (view.byteLength < 22) throw new Error("File is too small to be a zip archive.");

  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset + cdSize > view.byteLength) throw new Error("Zip central directory is truncated.");

  const entries = [];
  let cursor = cdOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < count; i++) {
    if (cursor + 46 > view.byteLength) throw new Error("Zip central directory is truncated.");
    if (view.getUint32(cursor, true) !== CENTRAL_SIG) {
      throw new Error("Zip central directory is corrupt.");
    }
    const flag = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compSize = view.getUint32(cursor + 20, true);
    const uncompSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameBytes = new Uint8Array(ab, cursor + 46, nameLen);
    const path = decodeName(nameBytes, Boolean(flag & UTF8_FLAG));
    cursor += 46 + nameLen + extraLen + commentLen;

    if (!path || path.endsWith("/")) continue;
    if (typeof skipPath === "function" && skipPath(path)) continue;

    if (uncompSize > maxUncompressedBytes) continue;

    totalUncompressed += uncompSize;
    if (totalUncompressed > maxUncompressedBytes * 2) {
      break;
    }

    if (localOffset + 30 > view.byteLength) throw new Error("Zip local header is truncated.");
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new Error("Zip local header is corrupt.");
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > view.byteLength) throw new Error("Zip entry data is truncated.");
    const raw = new Uint8Array(ab, dataStart, compSize);

    let bytes;
    if (method === 0) {
      bytes = raw.slice();
    } else if (method === 8) {
      bytes = await inflateRaw(raw);
    } else {
      throw new Error(`Zip uses unsupported compression method ${method}. Re-zip the folder, or upload the folder directly.`);
    }
    entries.push({ path, bytes });
  }

  return entries;
}
