// Reader for the "anima-web-1" inference blob written by server/weights_io.py:
//   "ANIMAWEB" | u32 header length | JSON header | pad to 4 | tensor data
// int8 ("q8") matrices carry one float32 scale per row; everything else is
// float32. Offsets in the header are relative to the start of the data.

const MAGIC = "ANIMAWEB";
export const WEB_FORMAT = "anima-web-1";

function align4(n) {
  return Math.ceil(n / 4) * 4;
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ config: object, special: { eot: number, user: number, anima: number },
 *   tokenizer: { vocab: Record<string, number>, merges: string[][] },
 *   tensors: Map<string, object> }}
 */
export function parseInferenceBlob(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  if (magic !== MAGIC) throw new Error("Not an Anima model file.");
  const view = new DataView(buffer);
  const headerLength = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder("utf-8").decode(bytes.subarray(12, 12 + headerLength)));
  if (header.format !== WEB_FORMAT) {
    throw new Error(`Unsupported model format ${header.format}.`);
  }
  const base = align4(12 + headerLength);
  const tensors = new Map();
  for (const t of header.tensors) {
    const count = t.shape.reduce((a, b) => a * b, 1);
    if (t.dtype === "q8") {
      const [rows, cols] = t.shape;
      tensors.set(t.name, {
        dtype: "q8",
        rows,
        cols,
        q: new Int8Array(buffer, base + t.offset, count),
        scales: new Float32Array(buffer, base + t.scales_offset, rows),
      });
    } else if (t.dtype === "f32") {
      tensors.set(t.name, {
        dtype: "f32",
        shape: t.shape,
        data: new Float32Array(buffer, base + t.offset, count),
      });
    } else {
      throw new Error(`Unknown tensor type ${t.dtype}.`);
    }
  }
  return {
    config: header.config,
    special: header.special,
    tokenizer: header.tokenizer,
    tensors,
  };
}
