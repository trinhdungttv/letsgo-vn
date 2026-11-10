// Bộ vẽ ảnh 360° bằng WebGL (không thư viện ngoài): mỗi điểm ảnh trên màn hình bắn 1 tia theo yaw / pitch / hfov rồi
// lấy màu từ ảnh cầu (equirectangular). Công thức tia ĐÚNG như lib/pano/sphere.ts (project / unproject) để nét vẽ
// và ghim công ty nằm khít trên ảnh.
//   • WebGL2: có mipmap + lọc dị hướng, tính gradient chống đường nối ở mép −180/180 → xa / gần đều mịn.
//   • WebGL1 (máy cũ): không mipmap, vẫn xem được.
import type { PanoView } from '../../lib/pano/sphere';

const VERT2 = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG2 = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uYaw;
uniform float uPitch;
uniform float uF;
uniform vec3 uCov;
uniform float uFull;
out vec4 outColor;
void main() {
  vec2 p = gl_FragCoord.xy - 0.5 * uRes;
  vec3 d = normalize(vec3(p.x, p.y, uF));
  float cp = cos(uPitch), sp = sin(uPitch);
  d = vec3(d.x, d.y * cp + d.z * sp, -d.y * sp + d.z * cp);
  float cy = cos(uYaw), sy = sin(uYaw);
  d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
  float lon = atan(d.x, d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(lon / uCov.x + 0.5, 0.5 - (lat - uCov.z) / uCov.y);
  vec2 uv2 = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  if (uFull > 0.5) {
    if (abs(dx2.x) < abs(dx.x)) dx.x = dx2.x;
    if (abs(dy2.x) < abs(dy.x)) dy.x = dy2.x;
  }
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { outColor = vec4(0.11, 0.11, 0.12, 1.0); return; }
  outColor = textureGrad(uTex, uv, dx, dy);
}`;

const VERT1 = `attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG1 = `precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uYaw;
uniform float uPitch;
uniform float uF;
uniform vec3 uCov;
uniform float uFull;
void main() {
  vec2 p = gl_FragCoord.xy - 0.5 * uRes;
  vec3 d = normalize(vec3(p.x, p.y, uF));
  float cp = cos(uPitch), sp = sin(uPitch);
  d = vec3(d.x, d.y * cp + d.z * sp, -d.y * sp + d.z * cp);
  float cy = cos(uYaw), sy = sin(uYaw);
  d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
  float lon = atan(d.x, d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(lon / uCov.x + 0.5, 0.5 - (lat - uCov.z) / uCov.y);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.11, 0.11, 0.12, 1.0); return; }
  gl_FragColor = texture2D(uTex, uv);
}`;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

export class NoWebGLError extends Error {}

/** Bộ vẽ chung cho PanoStage: WebGL (PanoRenderer) hoặc vẽ bằng CPU khi máy không có WebGL (panoSoft.ts). */
export interface PanoDrawer {
  setImage(img: HTMLImageElement, cov: Coverage, mobile: boolean): void;
  render(v: PanoView, dpr: number): void;
  dispose(): void;
}

export interface Coverage { haov: number; vaov: number; voffset: number }

export class PanoRenderer implements PanoDrawer {
  readonly gl: GL;
  readonly webgl2: boolean;
  readonly maxTexture: number;
  private prog: WebGLProgram;
  private tex: WebGLTexture | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private cov: Coverage = { haov: 360, vaov: 180, voffset: 0 };
  private buf: WebGLBuffer | null;

  constructor(private canvas: HTMLCanvasElement) {
    const opts: WebGLContextAttributes = { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
    const gl2 = canvas.getContext('webgl2', opts);
    const gl = gl2 ?? canvas.getContext('webgl', opts) ?? canvas.getContext('webgl')
      ?? (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    // Chrome 2025+ bỏ WebGL chạy bằng phần mềm: máy tắt tăng tốc đồ hoạ / GPU bị chặn → không có WebGL → PanoStage dùng panoSoft.ts
    if (!gl) throw new NoWebGLError('Máy / trình duyệt này không bật được WebGL (tăng tốc đồ hoạ).');
    this.gl = gl;
    this.webgl2 = !!gl2;
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.prog = this.link(this.webgl2 ? VERT2 : VERT1, this.webgl2 ? FRAG2 : FRAG1);
    gl.useProgram(this.prog);
    for (const n of ['uTex', 'uRes', 'uYaw', 'uPitch', 'uF', 'uCov', 'uFull']) this.loc[n] = gl.getUniformLocation(this.prog, n);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Lỗi dựng trình xem 360: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Lỗi dựng trình xem 360: ' + gl.getProgramInfoLog(p));
    return p;
  }

  /** Nạp ảnh (đã tải xong, cùng nguồn CORS) — ảnh quá to cho GPU / điện thoại thì thu nhỏ trước. */
  setImage(img: HTMLImageElement, cov: Coverage, mobile: boolean) {
    this.upload(fitTexture(img, this.maxTexture, mobile), cov);
  }

  private upload(src: TexImageSource, cov: Coverage) {
    const gl = this.gl;
    this.cov = cov;
    if (this.tex) gl.deleteTexture(this.tex);
    const tex = gl.createTexture();
    this.tex = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const full = cov.haov >= 359.5;
    if (this.webgl2) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, full ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number));
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
  }

  get ready() { return !!this.tex; }

  render(v: PanoView, dpr: number) {
    const gl = this.gl;
    const W = Math.max(1, Math.round(v.w * dpr)), H = Math.max(1, Math.round(v.h * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    gl.viewport(0, 0, W, H);
    if (!this.tex) { gl.clearColor(0.11, 0.11, 0.12, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const RAD = Math.PI / 180;
    gl.useProgram(this.prog);
    gl.uniform1i(this.loc.uTex, 0);
    gl.uniform2f(this.loc.uRes, W, H);
    gl.uniform1f(this.loc.uYaw, v.yaw * RAD);
    gl.uniform1f(this.loc.uPitch, v.pitch * RAD);
    gl.uniform1f(this.loc.uF, (W / 2) / Math.tan((v.hfov * RAD) / 2));
    gl.uniform3f(this.loc.uCov, this.cov.haov * RAD, this.cov.vaov * RAD, this.cov.voffset * RAD);
    gl.uniform1f(this.loc.uFull, this.cov.haov >= 359.5 ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    if (this.buf) gl.deleteBuffer(this.buf);
    gl.deleteProgram(this.prog);
    this.tex = null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Tải ảnh có CORS (để WebGL đọc được), thử lần lượt từng nguồn. */
export function loadPanoImage(urls: readonly string[], onProgress?: (msg: string) => void): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    let i = 0;
    const next = () => {
      if (i >= urls.length) { reject(new Error('Không mở được ảnh 360 (nguồn ảnh chặn đọc từ trang này hoặc link đã hết hạn).')); return; }
      const url = urls[i++];
      onProgress?.(i > 1 ? 'Đang thử nguồn ảnh dự phòng…' : 'Đang tải ảnh 360…');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve({ img, url });
      img.onerror = next;
      // Ảnh R2 có thể đã nằm trong bộ nhớ đệm từ lần xem thường (không CORS) → thêm tham số để trình duyệt tải lại kèm CORS
      img.src = !/^https?:/.test(url) || /googleusercontent\.com\//.test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}cors=1`;
    };
    next();
  });
}

/** Ảnh quá to cho GPU / điện thoại → thu nhỏ trên khung vẽ (giữ tỉ lệ). */
export function fitTexture(img: HTMLImageElement, maxTexture: number, mobile: boolean): TexImageSource {
  const limitW = Math.min(maxTexture, mobile ? 4096 : 8192);
  const w = img.naturalWidth, h = img.naturalHeight;
  // iPhone giới hạn khung vẽ ~16,7 triệu điểm ảnh
  const k = Math.min(1, limitW / w, maxTexture / h, Math.sqrt(16_000_000 / (w * h)));
  if (k >= 1) return img;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(w * k));
  c.height = Math.max(1, Math.floor(h * k));
  const ctx = c.getContext('2d');
  if (!ctx) return img;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
