// Device tier for perf defaults (perf audit #1). hardwareConcurrency alone missed most ₹10k phones (8 cores),
// so also use deviceMemory (Chrome/Android) and the GPU renderer string.
const mem=navigator.deviceMemory||8,cores=navigator.hardwareConcurrency||8;
export const MOBILE=matchMedia('(pointer:coarse)').matches||/Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);
function gpu(){try{const c=document.createElement('canvas'),gl=c.getContext('webgl',{powerPreference:'low-power'});if(!gl)return '';
  const ext=gl.getExtension('WEBGL_debug_renderer_info'),s=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  gl.getExtension('WEBGL_lose_context')?.loseContext();return String(s||'');}catch{return '';}}
export const GPU=gpu();
// Software GL, Mali-G5x/T-series, Adreno 3xx-6[0-1]x, PowerVR GE: low-end mobile GPUs common in budget phones.
const WEAK_GPU=/swiftshader|llvmpipe|software|mali-(t|g3|g5)|adreno \(tm\) ([3-5]\d\d|6[01]\d)|powervr|img be/i.test(GPU);
export const LOW_END=mem<=4||cores<=4||WEAK_GPU;
// "High quality 3D" (terrain): off by default on phones and low-end devices; the Layers sheet toggle is remembered.
// Storage can be blocked (private mode, WebView settings): fall back to an in-memory value so the map always loads.
let memPref=null;
export const terrainPref=()=>{let v=memPref;try{v=localStorage.getItem('vw-terrain')??memPref;}catch{}return v===null?!(MOBILE||LOW_END):v==='1';};
export const setTerrainPref=on=>{memPref=on?'1':'0';try{localStorage.setItem('vw-terrain',memPref);}catch{}};
