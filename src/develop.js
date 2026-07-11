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
    if(grain>0.0){                                         // film grain: 3D value noise (seed = static per-photo offset),
      vec2 gp = floor(uv/texel)/1.5;                       // per-channel = analog dye clouds, masked to mid-tones
      vec3 n = vec3(vnoise(vec3(gp, seed)), vnoise(vec3(gp, seed+19.7)), vnoise(vec3(gp, seed+43.1))) - 0.5;
      float Lg = dot(c, vec3(0.299,0.587,0.114));
      float mask = 4.0*Lg*(1.0-Lg);                        // strongest in mids, ~0 at pure black / blown highlights
      c += n * (grain/100.0) * 0.42 * mask;
    }
    o = vec4(clamp(c,0.0,1.0), 1.0);
  }`;

  RPDev.DEFAULT_PARAMS = { LUM: 0, CONTRAST: 75, RGAIN: 0, GGAIN: 0, BGAIN: 0, HUE: 0, SAT: 0 };

  // The one rule for the film auto-LUT: a ._FILM working copy whose filename (DCIM<date><NAME>_<seq>)
  // embeds a slot LUT name. Returns the uppercased LUT name, else null (Original_Film / other folders /
  // no embedded name). Shared by the gallery (preview + download bake) and Develop (auto-select on load).
  RPDev.filmLutName = function (fpath, name) {
    if (!/[\\/]\._FILM[\\/]/.test(fpath || "")) return null;
    const m = (name || "").match(/^DCIM\d{8}(.+?)_\d+\.[^.]+$/i);
    return m ? m[1].toUpperCase() : null;
  };

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
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const max3dTextureSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
    const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);

    function requireGpuDimensions(width, height, operation) {
      if (width > maxTextureSize || height > maxTextureSize) {
        throw new Error(operation + " " + width + "×" + height + " exceeds WebGL texture limit " + maxTextureSize + "×" + maxTextureSize);
      }
      if (width > maxViewportDims[0] || height > maxViewportDims[1]) {
        throw new Error(operation + " " + width + "×" + height + " exceeds WebGL viewport limit " + maxViewportDims[0] + "×" + maxViewportDims[1]);
      }
    }

    let photoW = 0, photoH = 0, edge = 0, hasLut = 0, photoTex = null, lutTex = null;

    function setPhoto(img) {
      const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
      requireGpuDimensions(width, height, "Photo");
      const previousTexture = photoTex, candidateTexture = gl.createTexture();
      if (!candidateTexture) throw new Error("WebGL could not allocate a photo texture");
      gl.activeTexture(gl.TEXTURE0);
      for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) {}       // drain prior errors
      try {
        gl.bindTexture(gl.TEXTURE_2D, candidateTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        const uploadError = gl.getError();
        if (uploadError !== gl.NO_ERROR) throw new Error("WebGL photo upload failed (error 0x" + uploadError.toString(16) + ")");
      } catch (error) {
        gl.deleteTexture(candidateTexture);
        gl.bindTexture(gl.TEXTURE_2D, previousTexture);
        throw error;
      }
      if (previousTexture) gl.deleteTexture(previousTexture);
      photoTex = candidateTexture; photoW = width; photoH = height;
    }
    function setLut(img) {
      if (!img) { hasLut = 0; return; }
      const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
      const pixelCount = width * height;
      const nextEdge = Math.round(Math.cbrt(pixelCount));
      const level = Math.round(Math.sqrt(nextEdge));
      const standardSide = nextEdge * level;
      if (nextEdge < 2 || nextEdge ** 3 !== pixelCount || level ** 2 !== nextEdge || width !== standardSide || height !== standardSide) {
        throw new Error("Unsupported HALD geometry " + width + "×" + height + "; expected a square level³×level³ image containing (level²)³ pixels");
      }
      if (nextEdge > max3dTextureSize) {
        throw new Error("HALD cube edge " + nextEdge + " exceeds WebGL 3D texture limit " + max3dTextureSize);
      }

      const c = document.createElement("canvas"); c.width = width; c.height = height;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0);
      const px = x.getImageData(0, 0, width, height).data;
      const cube = new Uint8Array(pixelCount * 3);
      for (let i = 0; i < pixelCount; i++) { cube[i * 3] = px[i * 4]; cube[i * 3 + 1] = px[i * 4 + 1]; cube[i * 3 + 2] = px[i * 4 + 2]; }

      const previousTexture = lutTex, candidateTexture = gl.createTexture();
      if (!candidateTexture) throw new Error("WebGL could not allocate a LUT texture");
      gl.activeTexture(gl.TEXTURE1);
      for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) {}
      try {
        gl.bindTexture(gl.TEXTURE_3D, candidateTexture);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        for (const p of ["TEXTURE_WRAP_S", "TEXTURE_WRAP_T", "TEXTURE_WRAP_R"]) gl.texParameteri(gl.TEXTURE_3D, gl[p], gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, nextEdge, nextEdge, nextEdge, 0, gl.RGB, gl.UNSIGNED_BYTE, cube);
        const uploadError = gl.getError();
        if (uploadError !== gl.NO_ERROR) throw new Error("WebGL LUT upload failed (error 0x" + uploadError.toString(16) + ")");
      } catch (error) {
        gl.deleteTexture(candidateTexture);
        gl.bindTexture(gl.TEXTURE_3D, previousTexture);
        throw error;
      }
      if (previousTexture) gl.deleteTexture(previousTexture);
      lutTex = candidateTexture; edge = nextEdge; hasLut = 1;
    }
    function render(params, outW, outH) {
      const p = Object.assign({}, RPDev.DEFAULT_PARAMS, params || {});
      const width = outW || photoW, height = outH || photoH;
      requireGpuDimensions(width, height, "Render output");
      cv.width = width; cv.height = height;
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
  const CK = "rp_custom_luts", CKR = "rp_custom_luts_rev";
  RPDev.customLuts = {
    list() { try { const o = JSON.parse(localStorage.getItem(CK) || "{}"); return Object.keys(o).sort().map((name) => ({ name, data: o[name] })); } catch (e) { return []; } },
    rev() { try { return localStorage.getItem(CKR) || "0"; } catch (e) { return "0"; } },
    _bump() { try { localStorage.setItem(CKR, Date.now().toString(36)); } catch (e) {} },
    add(name, dataUri) {
      const o = JSON.parse(localStorage.getItem(CK) || "{}"); o[name] = dataUri;
      try { localStorage.setItem(CK, JSON.stringify(o)); } catch (e) { throw new Error("storage full — remove a LUT in Library"); }
      this._bump();
    },
    remove(name) { const o = JSON.parse(localStorage.getItem(CK) || "{}"); delete o[name]; localStorage.setItem(CK, JSON.stringify(o)); this._bump(); },
  };

  /* Merged LUT catalog {name: src} — inlined RP_LUTS + custom uploads + the luts/ folder manifest.
   * Used by the gallery's auto-develop (LUT chosen from the filename's film name). */
  RPDev.lutCatalog = async function () {
    const cat = {};
    Object.keys(window.RP_LUTS || {}).forEach((n) => (cat[n] = window.RP_LUTS[n]));
    RPDev.customLuts.list().forEach((l) => { cat[l.name] = l.data; });
    try { const d = await fetch("luts/luts.json").then((r) => (r.ok ? r.json() : null)); if (d && d.luts) d.luts.forEach((l) => { if (!(l.name in cat)) cat[l.name] = "luts/" + l.file; }); } catch (e) {}
    return cat;
  };
})();
