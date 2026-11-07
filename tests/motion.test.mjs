import test from 'node:test';import assert from 'node:assert/strict';
import {wrap,travelHeading,easeIO,screenYaw,headingFromYaw,easeHeading,motionSpot,WALK_MS,MOTION_MAX_M,MOTION_HOLD_MS} from '../src/motion.js';
import {cardMotion} from '../proxy/life.js';
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

const anchor={lat:18.01,lon:79.53};
const metres=(a,b)=>Math.hypot((b.lon-a.lon)*111320*Math.cos(a.lat*Math.PI/180),(b.lat-a.lat)*111320);
test('a public walk is the published east/north offset, and only while its clock runs',()=>{
  const since=1_700_000_000_000,ms=WALK_MS,motion={east:600,north:0,ms,since};
  const card={...anchor,motion};
  const start=motionSpot(card,since);
  assert.equal(start.t,0);assert.equal(start.moving,false);assert.ok(metres(anchor,start)<1);
  const mid=motionSpot(card,since+ms/2);
  assert.equal(mid.t,.5);assert.equal(mid.moving,true);assert.ok(Math.abs(metres(anchor,mid)-300)<2);
  near(mid.heading,Math.PI/2);
  assert.ok(mid.lon>anchor.lon);assert.ok(Math.abs(mid.lat-anchor.lat)<1e-6);
  const end=motionSpot(card,since+ms);
  assert.equal(end.t,1);assert.equal(end.moving,false);assert.ok(Math.abs(metres(anchor,end)-600)<2);
  assert.equal(motionSpot(card,since+ms+MOTION_HOLD_MS).t,1);
  assert.equal(motionSpot(card,since+ms+MOTION_HOLD_MS+1),null);
  assert.equal(motionSpot(card,since-2000).t,0);
  assert.equal(motionSpot(card,since-10_000),null);
});
test('the drawn spot lands on the same offset the server published',()=>{
  const since=1_700_000_000_000;
  const destLat=anchor.lat+400/111320,destLon=anchor.lon+250/(111320*Math.cos(anchor.lat*Math.PI/180));
  const motion=cardMotion(anchor,{kind:'walking',since,destination:{lngLat:[destLon,destLat]}});
  assert.ok(motion&&motion.ms===WALK_MS);
  const end=motionSpot({...anchor,motion},since+motion.ms);
  assert.ok(Math.abs(metres(anchor,end)-Math.hypot(motion.east,motion.north))<1);
});
test('camera bearing is not an input: the same instant is the same place',()=>{
  const card={...anchor,motion:{east:100,north:80,ms:60_000,since:5_000}};
  assert.deepEqual(motionSpot(card,35_000),motionSpot(card,35_000));
});
test('missing, invalid, and oversized motion stay on the anchor',()=>{
  const now=10_000,since=5_000;
  for (const motion of [undefined,null,'walk',[],{east:1,north:1},{east:1,north:1,ms:0,since},{east:1,north:1,ms:WALK_MS+1,since},
    {east:MOTION_MAX_M,north:MOTION_MAX_M,ms:1000,since},{east:NaN,north:0,ms:1000,since},{east:10,north:0,ms:1000,since:-5}]){
    assert.equal(motionSpot({...anchor,motion},now),null,JSON.stringify(motion));
  }
  assert.equal(motionSpot({lat:NaN,lon:79,motion:{east:1,north:1,ms:1000,since}},now),null);
});
