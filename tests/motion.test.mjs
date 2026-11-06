import test from 'node:test';import assert from 'node:assert/strict';
import {wrap,travelHeading,easeIO,screenYaw,headingFromYaw,easeHeading} from '../src/motion.js';
const near=(a,b)=>assert.ok(Math.abs(wrap(a-b))<1e-6,`${a} vs ${b}`);
test('travel heading is world-space, clockwise from north',()=>{near(travelHeading([0,0],[0,1]),0);near(travelHeading([0,0],[1,0]),Math.PI/2);near(travelHeading([0,0],[0,-1]),Math.PI);});
test('rotating the camera changes the screen yaw by the same amount (agent holds its world heading)',()=>{
  const h=1.1;for(const b of [0,.5,2,-3]){near(screenYaw(h,b)-screenYaw(h,0),b);near(headingFromYaw(screenYaw(h,b),b),h);}
  near(screenYaw(0,0),Math.PI); // walking up the screen shows its back
  assert.notEqual(Math.round(screenYaw(h,0)*40),Math.round(screenYaw(h,Math.PI)*40)); // the other side gets drawn
});
test('heading eases the short way round and settles',()=>{let x=3;for(let i=0;i<60;i++)x=easeHeading(x,-3,1/30);near(x,-3);
  assert.ok(Math.abs(wrap(easeHeading(3,-3,1/30)))>3,'went through PI, not through 0');});
test('easing is smooth and bounded',()=>{assert.equal(easeIO(0),0);assert.equal(easeIO(1),1);near(easeIO(.5),.5);for(let f=0;f<1;f+=.05)assert.ok(easeIO(f+.05)>=easeIO(f));});
