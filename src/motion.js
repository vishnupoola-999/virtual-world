// Pure motion helpers for agents on the World map (no DOM, no three.js) so they can be unit-tested.
// Headings are WORLD space: radians clockwise from north. Screen yaw is the character's rotation.y in its offscreen scene.
export const wrap=x=>{x=(x+Math.PI)%(2*Math.PI);if(x<0)x+=2*Math.PI;return x-Math.PI;};
export const travelHeading=(from,to)=>Math.atan2((to[0]-from[0])*Math.cos(to[1]*Math.PI/180),to[1]-from[1]);
export const easeIO=f=>f<.5?2*f*f:1-(-2*f+2)**2/2;
// heading + map bearing (radians) -> screen yaw; inverse below. Facing up the screen shows the back (yaw = PI).
export const screenYaw=(heading,bearing)=>wrap(Math.PI-(heading-bearing));
export const headingFromYaw=(yaw,bearing)=>wrap(Math.PI-yaw+bearing);
// Ease a heading toward a target the shortest way round; dt in seconds (clamped by the caller).
export const easeHeading=(now,target,dt,rate=8)=>{const d=wrap(target-now);return Math.abs(d)<.002?target:now+d*Math.min(1,dt*rate);};
// A walk is drawn across this long so a 15-minute tick still shows the agent moving. Kept in step with proxy/life.js WALK_MS.
export const WALK_MS=90*60*1000;
export function walkFraction(since,now,ms=WALK_MS){const s=+since,n=+now,w=+ms;if(!Number.isFinite(s)||s<=0||!Number.isFinite(n)||!(w>0))return 0;return Math.max(0,Math.min(1,(n-s)/w));}
// from/to are [lng, lat]. f is 0..1.
export function alongLngLat(from,to,f){const t=Math.max(0,Math.min(1,+f||0));return [from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t];}
// Move a public ~1 km anchor by east/north metres times fraction. Used for other people's walking agents.
export function offsetPlace(lat,lon,east,north,fraction){const f=Math.max(0,Math.min(1,+fraction||0)),la=+lat,lo=+lon;
  if(!Number.isFinite(la)||!Number.isFinite(lo))return {lat:la,lon:lo};
  return {lat:la+(+north||0)*f/111320,lon:lo+(+east||0)*f/(111320*Math.cos(la*Math.PI/180))};}
