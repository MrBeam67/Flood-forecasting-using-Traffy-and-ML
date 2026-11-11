// Minimal EXIF reader: when was this JPEG photo taken?
// Returns a Date or null (no EXIF, not a JPEG, or a stripped/edited image).
// Reads DateTimeOriginal (0x9003) + OffsetTimeOriginal (0x9011), falling back to
// DateTime (0x0132). Without an offset the time is taken as the phone's local time.

export async function readPhotoTime(file) {
  try {
    const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (buf.getUint16(0) !== 0xffd8) return null; // not a JPEG
    let p = 2;
    while (p + 4 < buf.byteLength) {
      const marker = buf.getUint16(p);
      const len = buf.getUint16(p + 2);
      if (marker === 0xffe1 && buf.getUint32(p + 4) === 0x45786966) return parseTiff(buf, p + 10); // "Exif"
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null; // bad data / image data started
      p += 2 + len;
    }
  } catch {
    /* unreadable file */
  }
  return null;
}

function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949; // "II" little endian, "MM" big endian
  const u16 = (o) => v.getUint16(t + o, le);
  const u32 = (o) => v.getUint32(t + o, le);
  const ascii = (o, n) => {
    let s = "";
    for (let i = 0; i < n; i++) {
      const c = v.getUint8(t + o + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const readIfd = (off) => {
    const tags = {};
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      if (type === 2) tags[tag] = ascii(count > 4 ? u32(e + 8) : e + 8, count); // ASCII
      else if (type === 4) tags[tag] = u32(e + 8); // LONG (IFD pointers)
    }
    return tags;
  };

  const ifd0 = readIfd(u32(4));
  const sub = ifd0[0x8769] ? readIfd(ifd0[0x8769]) : {};
  const raw = sub[0x9003] || ifd0[0x0132];
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw || "");
  if (!m || m[1] === "0000") return null;
  const off = /^[+-]\d{2}:\d{2}$/.test(sub[0x9011] || "") ? sub[0x9011] : "";
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`;
  const d = new Date(iso); // no offset -> parsed as local time
  return isNaN(d) ? null : d;
}
