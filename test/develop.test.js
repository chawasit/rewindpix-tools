const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./harness");

test("customLuts persists named data URIs, returns them sorted, and removes only the requested LUT", () => {
  const window = loadModule("src/develop.js");
  window.RPDev.customLuts.add("Zulu", "data:image/png;base64,Wg==");
  window.RPDev.customLuts.add("Alpha", "data:image/png;base64,QQ==");
  assert.deepEqual(Array.from(window.RPDev.customLuts.list(), (lut) => ({ ...lut })), [
    { name: "Alpha", data: "data:image/png;base64,QQ==" },
    { name: "Zulu", data: "data:image/png;base64,Wg==" },
  ]);
  assert.deepEqual(JSON.parse(window.localStorage.getItem("rp_custom_luts")), {
    Zulu: "data:image/png;base64,Wg==",
    Alpha: "data:image/png;base64,QQ==",
  });
  window.RPDev.customLuts.remove("Alpha");
  assert.deepEqual(Array.from(window.RPDev.customLuts.list(), (lut) => ({ ...lut })), [
    { name: "Zulu", data: "data:image/png;base64,Wg==" },
  ]);
});

test("lutCatalog merges inline, custom, and folder LUTs with inline then custom precedence", async () => {
  const requests = [];
  const fetch = async (url) => {
    requests.push(url);
    return {
      ok: true,
      json: async () => ({ luts: [
        { name: "FolderOnly", file: "folder.png" },
        { name: "CustomWins", file: "loser-custom.png" },
        { name: "InlineWins", file: "loser-inline.png" },
      ] }),
    };
  };
  const window = loadModule("src/develop.js", {
    fetch,
    RP_LUTS: { InlineWins: "data:inline", BundledOnly: "data:bundled" },
  });
  window.RPDev.customLuts.add("CustomWins", "data:custom");
  window.RPDev.customLuts.add("InlineWins", "data:custom-loser");
  const catalog = await window.RPDev.lutCatalog();
  assert.deepEqual({ ...catalog }, {
    InlineWins: "data:inline",
    BundledOnly: "data:bundled",
    CustomWins: "data:custom",
    FolderOnly: "luts/folder.png",
  });
  assert.deepEqual(requests, ["luts/luts.json"]);
});
