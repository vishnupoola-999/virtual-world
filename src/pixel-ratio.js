// Adaptive pixel ratio: drop a step only when frames average over 33 ms (below 30 fps). Pure, unit tested.
export const PR_STEPS=[3,2,1.5,1];
export const startPixelRatio=(dpr,cap=2)=>Math.min(Math.max(1,dpr||1),cap);
// Next pixel ratio for an average frame time over a busy stretch, or null to keep the current one.
export function nextPixelRatio(pr,avgMs,floor=1){if(!(avgMs>1000/30))return null;const n=PR_STEPS.find(s=>s<pr-.01);return n!=null&&n>=floor?n:null;}
