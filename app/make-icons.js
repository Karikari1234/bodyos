// node make-icons.js -> icon-180.png, icon-512.png (orange square, cream ring). No deps.
const zlib = require('zlib'), fs = require('fs');
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
for (const S of [180, 512]) {
  const raw = Buffer.alloc((S * 3 + 1) * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - S / 2, y - S / 2) / S, ring = d > 0.24 && d < 0.32;
    const [r, g, b] = ring ? [246, 243, 239] : [238, 122, 60];
    raw.set([r, g, b], y * (S * 3 + 1) + 1 + x * 3);
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(S, 0); ih.writeUInt32BE(S, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(`icon-${S}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
