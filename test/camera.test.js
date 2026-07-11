const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./harness");
const { mockCamera } = require("./mock-camera");

function setup() {
  const camera = mockCamera();
  const window = loadModule("src/camera.js", { fetch: camera.fetch });
  return { camera, window, RP: window.RP };
}

test("cmd emits camera-compatible par and encoded str URLs with an optional trimmed base", async () => {
  const { camera, RP } = setup();
  await RP.cmd(8004, { par: 36 });
  RP.setBase("http://192.168.1.254///");
  await RP.cmd(4003, { str: "A:\\DCIM\\Original Film\\A:B.JPG" });
  assert.equal(camera.log[0].url, "/?custom=1&cmd=8004&par=36");
  assert.equal(camera.log[1].url, "http://192.168.1.254/?custom=1&cmd=4003&str=A:%5CDCIM%5COriginal%20Film%5CA:B.JPG");
  assert.equal(RP.base(), "http://192.168.1.254");
});

test("ackOk requires an explicit zero status and rejects missing or invalid responses", () => {
  const { RP } = setup();
  assert.equal(RP.ackOk("<Function><Status>0</Status></Function>"), true);
  assert.equal(RP.ackOk('<?xml version="1.0"?><Function><Status>0</Status></Function>'), true, "XML declaration");
  const rejected = [
    ["missing Status", "<Function><Cmd>1</Cmd></Function>"],
    ["negative camera error", "<Function><Status>-255</Status></Function>"],
    ["positive camera error", "<Function><Status>1</Status></Function>"],
    ["empty body", ""],
    ["whitespace body", " \r\n\t"],
    ["malformed XML", "<Function><Status>0</Function>"],
    ["HTML error page", "<!doctype html><html><body>Camera error</body></html>"],
    ["HTML embeds zero Status", "<html><Status>0</Status></html>"],
    ["truncated Function root", "<Function><Status>0</Status>"],
    ["content trails Function root", "<Function><Status>0</Status></Function><Other/>"],
    ["duplicate Status elements", "<Function><Status>0</Status><Status>0</Status></Function>"],
  ];
  for (const [name, body] of rejected) assert.equal(RP.ackOk(body), false, name);
});

test("camera identity, capacity, and roll status are parsed into consumer values", async () => {
  const { RP } = setup();
  const [firmware, model, freeFrames, status] = await Promise.all([
    RP.firmware(), RP.model(), RP.freeFrames(), RP.status(),
  ]);
  assert.deepEqual({ firmware, model, freeFrames, maxPhotos: status.maxPhotos }, {
    firmware: "V1.1.3", model: "PS135", freeFrames: 1229, maxPhotos: 99,
  });
});

test("listFiles preserves catalog metadata and derives each camera folder", async () => {
  const { camera, RP } = setup();
  camera.seed([
    ["Original_Film", "ONE.JPG", 101, 7],
    ["In_Camera_Mode", "TWO.JPG", 202, 8],
    ["._FILM", "THREE.JPG", 303, 9],
  ]);
  const files = await RP.listFiles();
  assert.deepEqual(Array.from(files, (file) => ({ ...file })), [
    { name: "ONE.JPG", fpath: "A:\\DCIM\\Original_Film\\ONE.JPG", folder: "Original_Film", size: 101, timecode: 7, time: "2026/07/10 06:07:00" },
    { name: "TWO.JPG", fpath: "A:\\DCIM\\In_Camera_Mode\\TWO.JPG", folder: "In_Camera_Mode", size: 202, timecode: 8, time: "2026/07/10 06:08:00" },
    { name: "THREE.JPG", fpath: "A:\\DCIM\\._FILM\\THREE.JPG", folder: "._FILM", size: 303, timecode: 9, time: "2026/07/10 06:09:00" },
  ]);
});

test("urlFor and downloadBlob map an A-drive FPATH to the camera HTTP path", async () => {
  const { camera, RP } = setup();
  RP.setBase("http://192.168.1.254");
  const fpath = "A:\\DCIM\\Original_Film\\ONE.JPG";
  assert.equal(RP.urlFor(fpath), "http://192.168.1.254/DCIM/Original_Film/ONE.JPG");
  const blob = await RP.downloadBlob(fpath);
  assert.equal(camera.log.at(-1).url, "http://192.168.1.254/DCIM/Original_Film/ONE.JPG");
  assert.equal(blob.type, "image/jpeg");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0xff, 0xd8, 0xff, 0xd9]);
});

test("seen paths persist uniquely and resetSeen removes the synchronization record", () => {
  const { window, RP } = setup();
  RP.markSeen(["A", "B", "A"]);
  RP.markSeen(["C"]);
  assert.deepEqual([...RP.seen()], ["A", "B", "C"]);
  assert.equal(window.localStorage.getItem("rp_synced_fpaths"), '["A","B","C"]');
  assert.ok(Object.keys(window.localStorage).includes("rp_synced_fpaths"));
  RP.resetSeen();
  assert.deepEqual([...RP.seen()], []);
  assert.equal(window.localStorage.getItem("rp_synced_fpaths"), null);
});

test("syncableFiles includes original and in-camera photos while excluding ._FILM twins", () => {
  const { RP } = setup();
  const files = [
    { folder: "Original_Film", name: "A" },
    { folder: "In_Camera_Mode", name: "B" },
    { folder: "._FILM", name: "A" },
    { folder: "Developed_Photos", name: "C" },
  ];
  assert.deepEqual(RP.syncableFiles(files).map((file) => file.name), ["A", "B"]);
});

test("setMaxPhotos and deleteFile emit confirmed writes and mutate mock camera state", async () => {
  const { camera, RP } = setup();
  const fpath = "A:\\DCIM\\Original_Film\\DCIM07102026GLVIVID_0003.JPG";
  await RP.setMaxPhotos(24);
  await RP.deleteFile(fpath);
  assert.deepEqual(camera.log.map(({ cmd, par, str }) => ({ cmd, par, str })), [
    { cmd: 8004, par: 24, str: null },
    { cmd: 4003, par: null, str: fpath },
  ]);
  assert.equal(camera.state.roll, 24);
  assert.equal(camera.state.files.some((file) => file[0] === "Original_Film" && file[1].endsWith("0003.JPG")), false);
});
