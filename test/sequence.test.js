const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./harness");
const { mockCamera } = require("./mock-camera");

function setup() {
  const camera = mockCamera();
  const window = loadModule("src/camera.js", { fetch: camera.fetch });
  return { camera, RP: window.RP };
}

test("setClock writes date before time because the date command zeroes time-of-day", async () => {
  const { camera, RP } = setup();
  const result = await RP.setClock(new Date(2026, 0, 2, 3, 4, 5));
  assert.deepEqual({ ...result }, { date: "2026-01-02", time: "03:04:05", ok: true });
  assert.deepEqual(camera.log.map(({ cmd, str }) => ({ cmd, str })), [
    { cmd: 3005, str: "2026-01-02" },
    { cmd: 3006, str: "03:04:05" },
  ]);
  assert.deepEqual({ date: camera.state.date, time: camera.state.time }, { date: "2026/01/02", time: "03:04:05" });
});

test("deleting several catalog entries sends one exact FPATH command per requested file", async () => {
  const { camera, RP } = setup();
  const paths = [
    "A:\\DCIM\\Original_Film\\A.JPG",
    "A:\\DCIM\\In_Camera_Mode\\B.JPG",
    "A:\\DCIM\\._FILM\\C.JPG",
  ];
  camera.seed([
    ["Original_Film", "A.JPG", 1, 1],
    ["In_Camera_Mode", "B.JPG", 2, 2],
    ["._FILM", "C.JPG", 3, 3],
  ]);
  await Promise.all(paths.map((fpath) => RP.deleteFile(fpath)));
  assert.deepEqual(camera.log.map(({ cmd, str }) => ({ cmd, str })), paths.map((str) => ({ cmd: 4003, str })));
  assert.deepEqual(camera.state.files, []);
});

test("setMaxPhotos zero clears the mock camera frame budget with cmd 8004 par 0", async () => {
  const { camera, RP } = setup();
  await RP.setMaxPhotos(0);
  assert.deepEqual(camera.log.map(({ cmd, par }) => ({ cmd, par })), [{ cmd: 8004, par: 0 }]);
  assert.equal(camera.state.roll, 0);
});

test("the single-client queue never overlaps concurrent commands and preserves submission order", async () => {
  const starts = [];
  let active = 0;
  let maxActive = 0;
  const fetch = async (url) => {
    const cmd = Number(new URL(url, "http://camera").searchParams.get("cmd"));
    starts.push(cmd);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, cmd === 1 ? 15 : 1));
    active--;
    return { ok: true, status: 200, text: async () => `<Function><Cmd>${cmd}</Cmd><Status>0</Status></Function>` };
  };
  const { RP } = loadModule("src/camera.js", { fetch });
  const results = await Promise.all([RP.cmd(1), RP.cmd(2), RP.cmd(3)]);
  assert.deepEqual(starts, [1, 2, 3]);
  assert.equal(maxActive, 1);
  assert.deepEqual(results.map((xml) => RP.tag(xml, "Cmd")), ["1", "2", "3"]);
});
