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
