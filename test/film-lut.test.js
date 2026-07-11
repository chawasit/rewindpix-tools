const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./harness");

const { filmLutName } = loadModule("src/develop.js").RPDev;
const validName = "DCIM07102026GLVIVID_0003.JPG";

test("extracts the LUT name from a backslash-delimited ._FILM path", () => {
  assert.equal(filmLutName("A:\\DCIM\\._FILM\\DCIM07102026GLVIVID_0003.JPG", validName), "GLVIVID");
});

test("extracts the LUT name from a forward-slash-delimited ._FILM path", () => {
  assert.equal(filmLutName("A:/DCIM/._FILM/DCIM07102026GLVIVID_0003.JPG", validName), "GLVIVID");
});

test("does not auto-apply a LUT to Original_Film paths", () => {
  assert.equal(filmLutName("A:\\DCIM\\Original_Film\\DCIM07102026GLVIVID_0003.JPG", validName), null);
  assert.equal(filmLutName("A:/DCIM/Original_Film/DCIM07102026GLVIVID_0003.JPG", validName), null);
});

test("does not auto-apply a LUT to In_Camera_Mode paths", () => {
  assert.equal(filmLutName("A:/DCIM/In_Camera_Mode/DCIM07102026GLVIVID_0003.JPG", validName), null);
});

test("rejects filenames outside the embedded film-name convention", () => {
  const filmPath = "A:/DCIM/._FILM/photo.jpg";
  assert.equal(filmLutName(filmPath, "snapshot.jpg"), null);
  assert.equal(filmLutName(filmPath, "IMG_1234.JPG"), null);
});

test("uppercases a lowercase embedded LUT name", () => {
  assert.equal(
    filmLutName("A:/DCIM/._FILM/dcim07102026glvivid_0003.jpg", "dcim07102026glvivid_0003.jpg"),
    "GLVIVID",
  );
});

test("returns null for absent or empty inputs", () => {
  assert.equal(filmLutName(null, null), null);
  assert.equal(filmLutName("", ""), null);
  assert.equal(filmLutName(undefined, undefined), null);
});

test("accepts a basename derived from a forward-slash Develop handoff path", () => {
  const fpath = "A:/DCIM/._FILM/DCIM07102026GLVIVID_0003.JPG";
  const basename = fpath.split(/[\\/]/).pop();
  assert.equal(filmLutName(fpath, basename), "GLVIVID");
});
