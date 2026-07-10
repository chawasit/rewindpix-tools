const FIELDS = ["LUM", "CONTRAST", "RGAIN", "GGAIN", "BGAIN", "HUE", "SAT"];
const FILM_SET = new Map([[8012, 1], [8014, 2], [8016, 3]]);
const INCAM_SET = new Map([[8006, 1], [8008, 2], [8010, 3]]);
const FILM_GET = new Map([[8013, 1], [8015, 2], [8017, 3]]);
const INCAM_GET = new Map([[8007, 1], [8009, 2], [8011, 3]]);

function defaults() {
  return {
    roll: 99,
    slots: ["GLVIVID", "GLEXP", "BWHC"],
    film: { 1: [0, 75, 0, 0, 0, 0, 0], 2: [10, 80, 0, 0, 0, 0, 20], 3: [0, 100, 0, 0, 0, 0, -100] },
    incam: { 1: Array(7).fill(-255), 2: Array(7).fill(-255), 3: Array(7).fill(-255) },
    date: "2026/07/10",
    time: "06:00:00",
    files: [
      ["Original_Film", "DCIM07102026GLVIVID_0003.JPG", 528992, 1600],
      ["In_Camera_Mode", "DCIM07102026SUNNY-WARM_0005.JPG", 1578000, 1550],
      ["._FILM", "DCIM07102026GLVIVID_0003.JPG", 528992, 1600],
    ],
  };
}

function mockCamera() {
  const log = [];
  const state = {};

  function reset() {
    log.length = 0;
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, defaults());
  }

  function seed(files) {
    state.files = files.map((file) => Array.isArray(file)
      ? [...file]
      : [file.folder, file.name, file.size, file.timecode]);
  }

  function response(body, { status = 200, type = "text/xml" } = {}) {
    const blob = body instanceof Blob ? body : new Blob([body], { type });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => blob.text(),
      blob: () => Promise.resolve(blob),
      arrayBuffer: () => blob.arrayBuffer(),
      json: async () => JSON.parse(await blob.text()),
    };
  }

  const fn = (cmd, extra = "") => `<Function><Cmd>${cmd}</Cmd><Status>0</Status>${extra}</Function>`;
  const parse7 = (value) => {
    const parsed = String(value || "").split(":").map(Number);
    return parsed.concat(Array(7).fill(0)).slice(0, 7).map((n) => Number.isFinite(n) ? n : 0);
  };
  const paramsXml = (values) => `<LIST>${FIELDS.map((field, i) => `<${field}>${values[i]}</${field}>`).join("")}</LIST>`;
  const filesXml = () => `<LIST>${state.files.map(([folder, name, size, timecode]) =>
    `<ALLFile><File><NAME>${name}</NAME><FPATH>A:\\DCIM\\${folder}\\${name}</FPATH><SIZE>${size}</SIZE><TIMECODE>${timecode}</TIMECODE><TIME>${state.date} 06:${String(timecode % 60).padStart(2, "0")}:00</TIME></File></ALLFile>`).join("")}</LIST>`;

  async function fetch(input, options = {}) {
    const rawUrl = String(input);
    const parsedUrl = new URL(rawUrl, "http://192.168.1.254");
    const method = String(options.method || "GET").toUpperCase();
    const cmdText = parsedUrl.searchParams.get("cmd");
    const cmd = cmdText === null ? null : Number(cmdText);
    const parText = parsedUrl.searchParams.get("par");
    const par = parText === null ? null : Number(parText);
    const str = parsedUrl.searchParams.get("str");
    log.push({ method, url: rawUrl, cmd, par, str });

    if (method === "POST") {
      const folder = parsedUrl.pathname.split("/").filter(Boolean).at(-1);
      const upload = options.body && [...options.body.entries()].find(([key]) => key === "fileupload1");
      if (folder && upload) {
        const file = upload[1];
        const name = file.name || "upload.jpg";
        const timecode = Math.max(1600, ...state.files.map((entry) => entry[3])) + 1;
        state.files = state.files.filter((entry) => entry[0] !== folder || entry[1] !== name);
        state.files.push([folder, name, file.size, timecode]);
      }
      return response("ok", { type: "text/plain" });
    }

    if (cmd === null) return response(new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)], { type: "image/jpeg" }));

    if (cmd === 8004) state.roll = par || 0;
    else if (cmd === 8002) state.slots = String(str || "").split(":").concat(["", "", ""]).slice(0, 3);
    else if (FILM_SET.has(cmd)) state.film[FILM_SET.get(cmd)] = parse7(str);
    else if (INCAM_SET.has(cmd)) state.incam[INCAM_SET.get(cmd)] = parse7(str);
    else if (cmd === 3005 && str) { state.date = str.replaceAll("-", "/"); state.time = "00:00:00"; }
    else if (cmd === 3006) state.time = str || state.time;
    else if (cmd === 3011) { state.slots = ["C1", "C2", "C3"]; for (let i = 1; i <= 3; i++) state.film[i] = Array(7).fill(-255); }
    else if (cmd === 4003) {
      const parts = String(str || "").replaceAll("\\", "/").split("/");
      const name = parts.at(-1), folder = parts.at(-2);
      state.files = state.files.filter((entry) => entry[0] !== folder || entry[1] !== name);
    }

    let xml;
    if (cmd === 3012) xml = fn(cmd, "<String>V1.1.3</String>");
    else if (cmd === 8018) xml = fn(cmd, "<String>PS135</String>");
    else if (cmd === 1003) xml = fn(cmd, "<Value>1229</Value>");
    else if (cmd === 3017) xml = fn(cmd, "<Value>3940000000</Value>");
    else if (cmd === 3024) xml = fn(cmd, "<Value>1</Value>");
    else if (cmd === 3014) xml = `<Function><Cmd>8004</Cmd><Status>${state.roll}</Status><Cmd>8005</Cmd><Status>2</Status></Function>`;
    else if (cmd === 3015) xml = filesXml();
    else if (cmd === 8003) xml = `<LIST><FILM_FILTER_C1>${state.slots[0]}</FILM_FILTER_C1><FILM_FILTER_C2>${state.slots[1]}</FILM_FILTER_C2><FILM_FILTER_C3>${state.slots[2]}</FILM_FILTER_C3></LIST>`;
    else if (FILM_GET.has(cmd)) xml = paramsXml(state.film[FILM_GET.get(cmd)]);
    else if (INCAM_GET.has(cmd)) xml = paramsXml(state.incam[INCAM_GET.get(cmd)]);
    else xml = fn(cmd);
    return response(`<?xml version="1.0" encoding="UTF-8" ?>\n${xml}`);
  }

  reset();
  return { fetch, log, state, reset, seed };
}

module.exports = { mockCamera };
