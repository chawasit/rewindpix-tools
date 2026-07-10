const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./harness");

function bytesOf(text) { return new TextEncoder().encode(text); }
function signatureAt(bytes, offset) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true); }

function readStoredEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({
      name: decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
      bytes: [...bytes.subarray(dataStart, dataStart + size)],
      size,
    });
    offset = dataStart + size;
  }
  return entries;
}

test("build emits local, central-directory, and end-of-central-directory ZIP records", async () => {
  const { RPZip } = loadModule("src/zip.js");
  const blob = RPZip.build([
    { name: "one.txt", bytes: bytesOf("one") },
    { name: "two.bin", bytes: Uint8Array.of(0, 1, 255) },
  ]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type, "application/zip");
  assert.equal(signatureAt(bytes, 0), 0x04034b50);
  assert.notEqual(bytes.findIndex((_, i) => i + 4 <= bytes.length && signatureAt(bytes, i) === 0x02014b50), -1);
  assert.equal(signatureAt(bytes, bytes.length - 22), 0x06054b50);
});

test("stored ZIP entries recover every UTF-8 name, declared length, and content byte", async () => {
  const { RPZip } = loadModule("src/zip.js");
  const expected = [
    { name: "first.jpg", bytes: [0xff, 0xd8, 1, 2] },
    { name: "folder/second.txt", bytes: [...bytesOf("hello")] },
    { name: "café.bin", bytes: [9, 8, 7] },
  ];
  const blob = RPZip.build(expected.map((entry) => ({ name: entry.name, bytes: Uint8Array.from(entry.bytes) })));
  const recovered = readStoredEntries(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(recovered, expected.map((entry) => ({ ...entry, size: entry.bytes.length })));
});
