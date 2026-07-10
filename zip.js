/* RewindPix — tiny dependency-free ZIP writer (STORE / no compression). Camera JPEGs are already
 * compressed, so storing keeps this small and fast, and the crc is the only per-file work.
 * RPZip.build([{ name, bytes: Uint8Array }]) -> Blob("application/zip").  No streaming: the whole
 * roll is held in memory (fine on desktop; a very large roll on a low-end phone may be tight —
 * fall back to per-photo download if it fails). */
(function () {
  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const enc = new TextEncoder();

  window.RPZip = {
    build(files) {
      const parts = [];      // local headers + names + data, in order
      const central = [];    // central-directory records
      let offset = 0;        // running offset of each local header
      for (const f of files) {
        const name = enc.encode(f.name);
        const data = f.bytes;
        const crc = crc32(data);
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); // UTF-8 name flag
        lh.setUint16(8, 0, true);   // method: store
        lh.setUint16(10, 0, true); lh.setUint16(12, 0, true); // dos time/date (0)
        lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
        lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
        parts.push(new Uint8Array(lh.buffer), name, data);

        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
        cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true); cd.setUint16(12, 0, true); cd.setUint16(14, 0, true);
        cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
        cd.setUint16(28, name.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true);
        cd.setUint16(34, 0, true); cd.setUint16(36, 0, true); cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
        central.push(new Uint8Array(cd.buffer), name);

        offset += 30 + name.length + data.length;
      }
      let cdSize = 0; for (const c of central) cdSize += c.length;
      const eocd = new DataView(new ArrayBuffer(22));
      eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(4, 0, true); eocd.setUint16(6, 0, true);
      eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
      eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true); eocd.setUint16(20, 0, true);
      return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: "application/zip" });
    },
  };
})();
