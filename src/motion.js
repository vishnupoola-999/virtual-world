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
// How long a life-loop walk stays "on the way" before the next decision. The proxy imports this same constant.
export const WALK_MS=90*60*1000;
// publicAgents.motion is metres from the card's rounded anchor. The proxy caps the offset at 900.
export const MOTION_MAX_M=900;
// The card can keep a finished walk until the next life tick republishes. Past this, the hint is stale.
export const MOTION_HOLD_MS=15*60*1000;
const MOTION_SKEW_MS=5000;
const M_PER_DEG=111320;

// Where another agent's public card should be drawn. Null means stay on the rounded anchor:
// missing, invalid, too far, not started, or stale. `t` is 0 at `since` and 1 at `since+ms`.
// East/north use the same metres-per-degree as proxy cardMotion, so the path is that offset and nothing else.
// The result does not depend on camera bearing.
export function motionSpot(card,now=Date.now()){
  const lat=Number(card?.lat),lon=Number(card?.lon),m=card?.motion;
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180)return null;
  if(!m||typeof m!=='object'||Array.isArray(m))return null;
  const east=Number(m.east),north=Number(m.north),ms=Number(m.ms),since=Number(m.since);
  if(!Number.isFinite(east)||!Number.isFinite(north)||!Number.isFinite(ms)||!Number.isFinite(since))return null;
  if(ms<=0||ms>WALK_MS||since<=0)return null;
  if(Math.hypot(east,north)>MOTION_MAX_M)return null;
  const cos=Math.cos(lat*Math.PI/180);
  if(Math.abs(cos)<1e-3)return null;
  if(since>now+MOTION_SKEW_MS)return null;
  if(now>since+ms+MOTION_HOLD_MS)return null;
  const t=now<=since?0:Math.min(1,(now-since)/ms);
  const eastM=east/(M_PER_DEG*cos),northM=north/M_PER_DEG;
  const heading=Math.hypot(east,north)>1?travelHeading([lon,lat],[lon+eastM,lat+northM]):undefined;
  return {lat:lat+northM*t,lon:lon+eastM*t,t,moving:t>0&&t<1,heading};
}
