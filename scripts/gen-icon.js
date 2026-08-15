'use strict';

/**
 * DeepSeek Harness icon generator (no external deps).
 *
 * Renders a rounded-square gradient tile with a white mark, using 2x
 * supersampling for smooth edges. Supports several mark designs.
 *
 * Usage:
 *   node scripts/gen-icon.js preview          -> write 3 design previews (256px)
 *   node scripts/gen-icon.js <design>         -> write assets/icon.png (256)
 *                                                and assets/tray-icon.png (32)
 *   designs: orbit | hex | h
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// --- PNG encoding ---------------------------------------------------------

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Pack multiple PNG buffers into a Windows .ico (PNG-compressed entries). */
function encodeICO(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const datas = [];
  images.forEach((img, i) => {
    const w = img.size >= 256 ? 0 : img.size;
    dir.writeUInt8(w, i * 16 + 0);
    dir.writeUInt8(w, i * 16 + 1);
    dir.writeUInt8(0, i * 16 + 2); // color count
    dir.writeUInt8(0, i * 16 + 3); // reserved
    dir.writeUInt16LE(1, i * 16 + 4); // planes
    dir.writeUInt16LE(32, i * 16 + 6); // bit count
    dir.writeUInt32LE(img.png.length, i * 16 + 8);
    dir.writeUInt32LE(offset, i * 16 + 12);
    datas.push(img.png);
    offset += img.png.length;
  });
  return Buffer.concat([header, dir, ...datas]);
}

// --- math / SDF helpers ---------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

function segDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const denom = abx * abx + aby * aby || 1;
  const t = clamp((apx * abx + apy * aby) / denom, 0, 1);
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return Math.hypot(dx, dy);
}

function circleDist(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

/** Signed distance to a regular hexagon (flat-top when flatTop). r = center->vertex. */
function hexDist(px, py, cx, cy, r, flatTop) {
  let x = px - cx;
  let y = py - cy;
  if (flatTop) {
    const t = x;
    x = y;
    y = t;
  }
  x = Math.abs(x);
  y = Math.abs(y);
  const kx = -0.866025404;
  const ky = 0.5;
  const kz = 0.577350269;
  const d = Math.min(x * kx + y * ky, 0);
  x -= 2 * d * kx;
  y -= 2 * d * ky;
  x -= clamp(x, -kz * r, kz * r);
  y -= r;
  return Math.hypot(x, y) * Math.sign(y);
}

/** Sample a closed Catmull-Rom spline through pts into a polygon. */
function catmullRom(pts, samples) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let k = 0; k < samples; k++) {
      const t = k / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  return out;
}

function pointInPolygon(px, py, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i][0];
    const yi = verts[i][1];
    const xj = verts[j][0];
    const yj = verts[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed distance to a polygon (negative inside, via even-odd). */
function polygonDist(px, py, verts) {
  let minD = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const d = segDist(px, py, a[0], a[1], b[0], b[1]);
    if (d < minD) minD = d;
  }
  return pointInPolygon(px, py, verts) ? -minD : minD;
}

function roundedRectSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Blue -> cyan gradient (cleaner than the previous purple-mixed ramp). */
function gradient(t) {
  const stops = [
    [0.0, [58, 110, 255]],
    [0.55, [52, 140, 250]],
    [1.0, [34, 211, 238]]
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return [
        Math.round(lerp(c0[0], c1[0], u)),
        Math.round(lerp(c0[1], c1[1], u)),
        Math.round(lerp(c0[2], c1[2], u))
      ];
    }
  }
  return stops[stops.length - 1][1];
}

// --- mark designs (return 0..1 white coverage for a point) ----------------

const AA = 0.8;
const cover = (d) => 1 - smoothstep(-AA, AA, d);
const coverStroke = (d, halfW) => 1 - smoothstep(halfW - AA, halfW + AA, d);

/** Design 1 — orbit / hub-and-spoke network. */
function orbitMark(x, y, c, s) {
  const hubR = s * 0.058;
  const ringR = s * 0.245;
  const nodeR = s * 0.042;
  const lineHW = s * 0.0085;
  const N = 8;
  const nodes = [];
  for (let k = 0; k < N; k++) {
    const a = (k * 2 * Math.PI) / N - Math.PI / 2;
    nodes.push([c + ringR * Math.cos(a), c + ringR * Math.sin(a)]);
  }
  let cov = cover(circleDist(x, y, c, c, hubR));
  for (let k = 0; k < N; k++) {
    const [nx, ny] = nodes[k];
    cov = Math.max(cov, coverStroke(segDist(x, y, c, c, nx, ny), lineHW));
    const [bx, by] = nodes[(k + 1) % N];
    cov = Math.max(cov, coverStroke(segDist(x, y, nx, ny, bx, by), lineHW));
  }
  for (const [nx, ny] of nodes) cov = Math.max(cov, cover(circleDist(x, y, nx, ny, nodeR)));
  return cov;
}

/** Design 2 — hexagon hub. */
function hexMark(x, y, c, s) {
  const outR = s * 0.30;
  const strokeHW = s * 0.0175;
  const centerR = s * 0.062;
  let cov = coverStroke(Math.abs(hexDist(x, y, c, c, outR, true)), strokeHW);
  cov = Math.max(cov, cover(circleDist(x, y, c, c, centerR)));
  return cov;
}

/** Design 3 — bold "H" monogram. */
function hMark(x, y, c, s) {
  const halfW = s * 0.024;
  const top = c - s * 0.135;
  const bottom = c + s * 0.135;
  const left = c - s * 0.105;
  const right = c + s * 0.105;
  const mid = c;
  let cov = coverStroke(segDist(x, y, left, top, left, bottom), halfW);
  cov = Math.max(cov, coverStroke(segDist(x, y, right, top, right, bottom), halfW));
  cov = Math.max(cov, coverStroke(segDist(x, y, left, mid, right, mid), halfW));
  return cov;
}

const DESIGNS = { orbit: orbitMark, hex: hexMark, h: hMark, whale: whaleMark };

/** Whale outline (facing left) in unit coordinates; eye as a cutout. */
const WHALE_POINTS = [
  [0.08, 0.52],
  [0.16, 0.40],
  [0.36, 0.32],
  [0.62, 0.34],
  [0.78, 0.44],
  [0.94, 0.30],
  [0.83, 0.51],
  [0.90, 0.70],
  [0.74, 0.57],
  [0.52, 0.70],
  [0.30, 0.68],
  [0.15, 0.63]
];
const WHALE_EYE = [0.27, 0.47];
const WHALE_EYE_R = 0.034;

/** Design 4 — DeepSeek-style whale. */
function whaleMark(x, y, c, s) {
  const m = s * 0.055;
  const scale = s - 2 * m;
  const pts = WHALE_POINTS.map(([a, b]) => [m + a * scale, m + b * scale]);
  const poly = catmullRom(pts, 10);
  let cov = cover(polygonDist(x, y, poly));
  const ex = m + WHALE_EYE[0] * scale;
  const ey = m + WHALE_EYE[1] * scale;
  cov = Math.max(0, cov - cover(circleDist(x, y, ex, ey, WHALE_EYE_R * scale)));
  return cov;
}

// --- rendering ------------------------------------------------------------

function renderTile(size, markFn) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const pad = Math.max(1, size * 0.01);
  const hw = size / 2 - pad;
  const radius = size * 0.21;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = roundedRectSDF(px, py, cx, cx, hw, hw, radius);
      const coverage = 1 - smoothstep(-0.75, 0.75, d);
      if (coverage <= 0) continue;

      const t = clamp((px + py) / (2 * size), 0, 1);
      const [r, g, b] = gradient(t);
      const m = clamp(markFn(px, py, cx, size), 0, 1);

      // Subtle inner highlight along the top-left edge for depth.
      const hi = smoothstep(hw * 0.55, hw * 0.95, px + py);

      const i = (y * size + x) * 4;
      rgba[i] = Math.round(lerp(lerp(r, 255, m), 255, hi * 0.06));
      rgba[i + 1] = Math.round(lerp(lerp(g, 255, m), 255, hi * 0.06));
      rgba[i + 2] = Math.round(lerp(lerp(b, 255, m), 255, hi * 0.06));
      rgba[i + 3] = Math.round(255 * coverage);
    }
  }
  return rgba;
}

function downsample(hi, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((y * 2 + dy) * size * 2 + (x * 2 + dx)) * 4;
          const al = hi[i + 3] / 255;
          r += hi[i] * al;
          g += hi[i + 1] * al;
          b += hi[i + 2] * al;
          a += al;
        }
      }
      a /= 4;
      r /= 4;
      g /= 4;
      b /= 4;
      const j = (y * size + x) * 4;
      if (a > 0) {
        out[j] = Math.round(r / a);
        out[j + 1] = Math.round(g / a);
        out[j + 2] = Math.round(b / a);
      }
      out[j + 3] = Math.round(a * 255);
    }
  }
  return out;
}

function renderIcon(size, markFn) {
  return downsample(renderTile(size * 2, markFn), size);
}

// --- main -----------------------------------------------------------------

function main() {
  const arg = process.argv[2];
  const outDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });

  if (arg === 'preview') {
    for (const [name, markFn] of Object.entries(DESIGNS)) {
      const p = path.join(outDir, `preview-${name}.png`);
      fs.writeFileSync(p, encodePNG(256, 256, renderIcon(256, markFn)));
      console.log(`wrote ${p}`);
    }
    return;
  }

  if (arg === 'ascii') {
    printAscii(process.argv[3] || 'whale');
    return;
  }

  if (arg === 'svg') {
    console.log(JSON.stringify(whaleSvg(), null, 2));
    return;
  }

  const markFn = DESIGNS[arg];
  if (!markFn) {
    console.error('usage: node gen-icon.js preview | ascii <design> | svg | orbit | hex | h | whale');
    process.exit(1);
  }

  fs.writeFileSync(path.join(outDir, 'icon.png'), encodePNG(256, 256, renderIcon(256, markFn)));
  fs.writeFileSync(path.join(outDir, 'tray-icon.png'), encodePNG(32, 32, renderIcon(32, markFn)));
  const icoImages = [16, 24, 32, 48, 64, 128, 256].map((sz) => ({ size: sz, png: encodePNG(sz, sz, renderIcon(sz, markFn)) }));
  fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeICO(icoImages));
  console.log(`wrote assets/icon.png + tray-icon.png + icon.ico (design: ${arg})`);
}

/** Print an ASCII rendering of a mark (sanity check). */
function printAscii(name) {
  const markFn = DESIGNS[name];
  if (!markFn) {
    console.error('unknown design: ' + name);
    process.exit(1);
  }
  const W = Number(process.argv[4] || 44);
  const H = Number(process.argv[5] || W);
  const c = W / 2;
  for (let y = 0; y < H; y++) {
    let line = '';
    for (let x = 0; x < W; x++) {
      line += markFn(x + 0.5, (y + 0.5) * (W / H), c, W) > 0.5 ? '##' : '  ';
    }
    console.log(line);
  }
}

/** Whale outline (in a 256 viewBox) as an SVG path, plus the eye circle. */
function whaleSvg() {
  const m = 256 * 0.055;
  const scale = 256 - 2 * m;
  const pts = WHALE_POINTS.map(([a, b]) => [m + a * scale, m + b * scale]);
  const poly = catmullRom(pts, 12);
  const d = 'M' + poly.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') + ' Z';
  const ex = (m + WHALE_EYE[0] * scale).toFixed(1);
  const ey = (m + WHALE_EYE[1] * scale).toFixed(1);
  const er = (WHALE_EYE_R * scale).toFixed(1);
  return { d, eye: { cx: ex, cy: ey, r: er } };
}

main();
