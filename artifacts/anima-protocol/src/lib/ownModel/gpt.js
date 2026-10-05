// The own model's forward pass, in plain JavaScript over int8 weights.
// Mirrors training/phase1/train.py's GPT: pre-LayerNorm blocks, causal
// attention with a fused qkv projection, exact (erf) GELU, untied head.
// A KV cache makes each new token cost one pass over the weights
// (~12M multiply-adds for the default 13M-parameter config).

/** erf with < 1.2e-7 fractional error (Numerical Recipes erfc). */
function erf(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? 1 - r : r - 1;
}

const SQRT1_2 = Math.SQRT1_2;

function linear(out, x, weight, bias) {
  const { q, scales, rows, cols } = weight;
  for (let r = 0; r < rows; r++) {
    let acc = 0;
    const base = r * cols;
    for (let c = 0; c < cols; c++) acc += q[base + c] * x[c];
    out[r] = acc * scales[r] + (bias ? bias[r] : 0);
  }
}

function layerNorm(out, x, weight, bias, n) {
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - mean;
    variance += d * d;
  }
  const inv = 1 / Math.sqrt(variance / n + 1e-5);
  for (let i = 0; i < n; i++) out[i] = (x[i] - mean) * inv * weight[i] + bias[i];
}

function embedRow(out, weight, row, add) {
  const { q, scales, cols } = weight;
  const scale = scales[row];
  const base = row * cols;
  for (let c = 0; c < cols; c++) out[c] = (add ? out[c] : 0) + q[base + c] * scale;
}

export class TinyGpt {
  /** @param {ReturnType<typeof import("./blob.js").parseInferenceBlob>} parsed */
  constructor(parsed) {
    const { config, tensors } = parsed;
    this.config = config;
    const get = (name) => {
      const t = tensors.get(name);
      if (!t) throw new Error(`Model file is missing ${name}.`);
      return t;
    };
    const f32 = (name) => get(name).data;
    this.tokEmb = get("tok_emb.weight");
    this.posEmb = get("pos_emb.weight");
    this.blocks = [];
    for (let i = 0; i < config.n_layer; i++) {
      const p = `blocks.${i}.`;
      this.blocks.push({
        ln1w: f32(`${p}ln1.weight`),
        ln1b: f32(`${p}ln1.bias`),
        qkv: get(`${p}attn.qkv.weight`),
        qkvb: f32(`${p}attn.qkv.bias`),
        proj: get(`${p}attn.proj.weight`),
        projb: f32(`${p}attn.proj.bias`),
        ln2w: f32(`${p}ln2.weight`),
        ln2b: f32(`${p}ln2.bias`),
        fc: get(`${p}mlp.0.weight`),
        fcb: f32(`${p}mlp.0.bias`),
        out: get(`${p}mlp.2.weight`),
        outb: f32(`${p}mlp.2.bias`),
      });
    }
    this.lnfw = f32("ln_f.weight");
    this.lnfb = f32("ln_f.bias");
    this.head = get("head.weight");
    const C = config.n_embd;
    this.buf = {
      x: new Float32Array(C),
      h: new Float32Array(C),
      qkv: new Float32Array(3 * C),
      y: new Float32Array(C),
      proj: new Float32Array(C),
      mlp: new Float32Array(4 * C),
      scores: new Float32Array(config.block_size),
    };
  }

  newCache() {
    const { n_layer, block_size, n_embd } = this.config;
    return {
      length: 0,
      k: Array.from({ length: n_layer }, () => new Float32Array(block_size * n_embd)),
      v: Array.from({ length: n_layer }, () => new Float32Array(block_size * n_embd)),
    };
  }

  /** Feed one token at the cache's next position; returns the next-token logits. */
  step(token, cache) {
    const { n_embd: C, n_head, block_size, vocab_size } = this.config;
    const pos = cache.length;
    if (pos >= block_size) throw new Error("Context window is full.");
    const { x, h, qkv, y, proj, mlp, scores } = this.buf;
    const hd = C / n_head;
    const scale = 1 / Math.sqrt(hd);

    embedRow(x, this.tokEmb, token, false);
    embedRow(x, this.posEmb, pos, true);

    for (let l = 0; l < this.blocks.length; l++) {
      const b = this.blocks[l];
      layerNorm(h, x, b.ln1w, b.ln1b, C);
      linear(qkv, h, b.qkv, b.qkvb);
      const K = cache.k[l];
      const V = cache.v[l];
      K.set(qkv.subarray(C, 2 * C), pos * C);
      V.set(qkv.subarray(2 * C, 3 * C), pos * C);
      for (let head = 0; head < n_head; head++) {
        const off = head * hd;
        let max = -Infinity;
        for (let t = 0; t <= pos; t++) {
          let s = 0;
          const kb = t * C + off;
          for (let d = 0; d < hd; d++) s += qkv[off + d] * K[kb + d];
          s *= scale;
          scores[t] = s;
          if (s > max) max = s;
        }
        let sum = 0;
        for (let t = 0; t <= pos; t++) {
          const e = Math.exp(scores[t] - max);
          scores[t] = e;
          sum += e;
        }
        for (let d = 0; d < hd; d++) y[off + d] = 0;
        for (let t = 0; t <= pos; t++) {
          const p = scores[t] / sum;
          const vb = t * C + off;
          for (let d = 0; d < hd; d++) y[off + d] += p * V[vb + d];
        }
      }
      linear(proj, y, b.proj, b.projb);
      for (let i = 0; i < C; i++) x[i] += proj[i];

      layerNorm(h, x, b.ln2w, b.ln2b, C);
      linear(mlp, h, b.fc, b.fcb);
      for (let i = 0; i < 4 * C; i++) {
        const v = mlp[i];
        mlp[i] = 0.5 * v * (1 + erf(v * SQRT1_2));
      }
      linear(proj, mlp, b.out, b.outb);
      for (let i = 0; i < C; i++) x[i] += proj[i];
    }

    layerNorm(h, x, this.lnfw, this.lnfb, C);
    const logits = new Float32Array(vocab_size);
    linear(logits, h, this.head, null);
    cache.length = pos + 1;
    return logits;
  }
}

/**
 * Pick the next token. temperature <= 1e-4 is greedy; otherwise top-k
 * sampling, like server/modeling.py.
 */
export function sampleToken(logits, { temperature = 0.8, topK = 40, random = Math.random } = {}) {
  let best = 0;
  for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
  if (!(temperature > 1e-4)) return best;
  const k = Math.min(Math.max(Math.floor(topK) || logits.length, 1), logits.length);
  const order = Array.from(logits.keys()).sort((a, b) => logits[b] - logits[a]).slice(0, k);
  const top = logits[order[0]];
  let sum = 0;
  const weights = order.map((i) => {
    const w = Math.exp((logits[i] - top) / temperature);
    sum += w;
    return w;
  });
  let r = random() * sum;
  for (let i = 0; i < order.length; i++) {
    r -= weights[i];
    if (r <= 0) return order[i];
  }
  return order[order.length - 1];
}
