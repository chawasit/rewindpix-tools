/* RewindPix develop engine — WebGL2 HALD-CLUT + 7 params. Global `RPDev`. No build step.
 * Validated approach: HALD PNG row-major == r-fastest 3D order → upload directly as a 3D texture,
 * LINEAR filtering = hardware trilinear. Params approximate the camera's LUM:CON:RG:GG:BG:HUE:SAT
 * (off-camera adjustments; the LUT is the primary look). Defaults 0:75:0:0:0:0:0 = LUT-only. */
(function () {
  const RPDev = (window.RPDev = {});

  RPDev.load = (src) => new Promise((res, rej) => {
    const i = new Image(); i.crossOrigin = "anonymous";
    i.onload = () => res(i); i.onerror = () => rej(new Error("image load failed: " + src)); i.src = src;
  });

  const VS = `#version 300 es
  in vec2 p; out vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0,1); }`;

  const FS = `#version 300 es
  precision highp float; precision highp sampler3D;
  in vec2 uv; out vec4 o;
  uniform sampler2D img; uniform sampler3D lut; uniform float edge; uniform int useLut;
  uniform float lum, con, rg, gg, bg, hue, sat;
  uniform float denoise, grain, seed; uniform vec2 texel;
  vec3 hueRotate(vec3 col, float a){
    float c=cos(a), s=sin(a);
    vec3 rr=vec3(0.213+0.787*c-0.213*s, 0.715-0.715*c-0.715*s, 0.072-0.072*c+0.928*s);
    vec3 gg2=vec3(0.213-0.213*c+0.143*s, 0.715+0.285*c+0.140*s, 0.072-0.072*c-0.283*s);
    vec3 bb=vec3(0.213-0.213*c-0.787*s, 0.715-0.715*c+0.715*s, 0.072+0.928*c+0.072*s);
    return vec3(dot(col,rr), dot(col,gg2), dot(col,bb));
  }
  vec3 samp(vec2 t){ return texture(img, vec2(t.x, 1.0-t.y)).rgb; }
  float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
  float hash13(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
  float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash13(i+vec3(0,0,0)),hash13(i+vec3(1,0,0)),f.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x), f.y),
               mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x), f.y), f.z); }
  void main(){
    vec3 c = samp(uv);
    if(denoise>0.0){                                       // edge-preserving 3x3 bilateral blend
      float amt=denoise/100.0; vec3 sum=c; float wsum=1.0;
      for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){
        if(dx==0&&dy==0) continue;
        vec3 n=samp(uv+vec2(float(dx),float(dy))*texel);
        float w=1.0-clamp(length(n-c)*3.0,0.0,1.0);        // similar colours weigh more (keeps edges)
        sum+=n*w; wsum+=w;
      }
      c=mix(c,sum/wsum,amt);
    }
    if(useLut==1){ vec3 s3=(c*(edge-1.0)+0.5)/edge; c = texture(lut, s3).rgb; }
    c *= vec3(1.0+rg/128.0, 1.0+gg/128.0, 1.0+bg/128.0);   // per-channel gain (0 neutral)
    c = (c-0.5)*(con/75.0)+0.5;                            // contrast (75 neutral)
    c += lum/200.0;                                        // brightness
    c = clamp(c,0.0,1.0);
    c = hueRotate(c, hue/100.0*0.6);                       // hue
    float L = dot(c, vec3(0.299,0.587,0.114));
    c = mix(vec3(L), c, 1.0+sat/100.0);                    // saturation (0 neutral, -100 = mono)
    c = clamp(c,0.0,1.0);
    if(grain>0.0){                                         // film grain: 3D value noise (seed = shifting/time dim),
      vec2 gp = floor(uv/texel)/1.5;                       // per-channel = analog dye clouds, masked to mid-tones
      vec3 n = vec3(vnoise(vec3(gp, seed)), vnoise(vec3(gp, seed+19.7)), vnoise(vec3(gp, seed+43.1))) - 0.5;
      float Lg = dot(c, vec3(0.299,0.587,0.114));
      float mask = 4.0*Lg*(1.0-Lg);                        // strongest in mids, ~0 at pure black / blown highlights
      c += n * (grain/100.0) * 0.42 * mask;
    }
    o = vec4(clamp(c,0.0,1.0), 1.0);
  }`;

  RPDev.DEFAULT_PARAMS = { LUM: 0, CONTRAST: 75, RGAIN: 0, GGAIN: 0, BGAIN: 0, HUE: 0, SAT: 0 };

  RPDev.createEngine = function () {
    const cv = document.createElement("canvas");
    const gl = cv.getContext("webgl2", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 not available");

    function sh(t, src) { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pl = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(prog, n);
    gl.uniform1i(U("img"), 0); gl.uniform1i(U("lut"), 1);

    let photoW = 0, photoH = 0, edge = 0, hasLut = 0;

    function setPhoto(img) {
      photoW = img.naturalWidth || img.width; photoH = img.naturalHeight || img.height;
      gl.activeTexture(gl.TEXTURE0); const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    function setLut(img) {
      if (!img) { hasLut = 0; return; }
      const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0);
      const px = x.getImageData(0, 0, c.width, c.height).data;
      edge = Math.round(Math.cbrt(c.width * c.height));
      const N = edge * edge * edge, cube = new Uint8Array(N * 3);
      for (let i = 0; i < N; i++) { cube[i * 3] = px[i * 4]; cube[i * 3 + 1] = px[i * 4 + 1]; cube[i * 3 + 2] = px[i * 4 + 2]; }
      gl.activeTexture(gl.TEXTURE1); const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, edge, edge, edge, 0, gl.RGB, gl.UNSIGNED_BYTE, cube);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const p of ["TEXTURE_WRAP_S", "TEXTURE_WRAP_T", "TEXTURE_WRAP_R"]) gl.texParameteri(gl.TEXTURE_3D, gl[p], gl.CLAMP_TO_EDGE);
      hasLut = 1;
    }
    function render(params, outW, outH) {
      const p = Object.assign({}, RPDev.DEFAULT_PARAMS, params || {});
      cv.width = outW || photoW; cv.height = outH || photoH;
      gl.uniform1f(U("edge"), edge || 2); gl.uniform1i(U("useLut"), hasLut);
      gl.uniform1f(U("lum"), p.LUM); gl.uniform1f(U("con"), p.CONTRAST);
      gl.uniform1f(U("rg"), p.RGAIN); gl.uniform1f(U("gg"), p.GGAIN); gl.uniform1f(U("bg"), p.BGAIN);
      gl.uniform1f(U("hue"), p.HUE); gl.uniform1f(U("sat"), p.SAT);
      gl.uniform1f(U("denoise"), p.DENOISE || 0); gl.uniform1f(U("grain"), p.GRAIN || 0);
      gl.uniform2f(U("texel"), 1.0 / (photoW || cv.width || 1), 1.0 / (photoH || cv.height || 1)); gl.uniform1f(U("seed"), p.SEED != null ? p.SEED : Math.random() * 100.0);
      gl.viewport(0, 0, cv.width, cv.height); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.finish();
    }
    const toBlob = (type, q) => new Promise((res) => cv.toBlob(res, type || "image/jpeg", q == null ? 0.92 : q));

    return { canvas: cv, gl, setPhoto, setLut, render, toBlob,
      get size() { return [photoW, photoH]; } };
  };

  /* User-uploaded LUTs: name -> data URI, persisted in localStorage (best-effort; small HALD PNGs). */
  const CK = "rp_custom_luts";
  RPDev.customLuts = {
    list() { try { const o = JSON.parse(localStorage.getItem(CK) || "{}"); return Object.keys(o).sort().map((name) => ({ name, data: o[name] })); } catch (e) { return []; } },
    add(name, dataUri) {
      const o = JSON.parse(localStorage.getItem(CK) || "{}"); o[name] = dataUri;
      try { localStorage.setItem(CK, JSON.stringify(o)); } catch (e) { throw new Error("storage full — remove a LUT in Library"); }
    },
    remove(name) { const o = JSON.parse(localStorage.getItem(CK) || "{}"); delete o[name]; localStorage.setItem(CK, JSON.stringify(o)); },
  };

  /* Merged LUT catalog {name: src} — inlined RP_LUTS + custom uploads + the luts/ folder manifest.
   * Used by the gallery's auto-develop (LUT chosen from the filename's film name). */
  RPDev.lutCatalog = async function () {
    const cat = {};
    Object.keys(window.RP_LUTS || {}).forEach((n) => (cat[n] = window.RP_LUTS[n]));
    RPDev.customLuts.list().forEach((l) => { if (!(l.name in cat)) cat[l.name] = l.data; });
    try { const d = await fetch("luts/luts.json").then((r) => (r.ok ? r.json() : null)); if (d && d.luts) d.luts.forEach((l) => { if (!(l.name in cat)) cat[l.name] = "luts/" + l.file; }); } catch (e) {}
    return cat;
  };
})();
