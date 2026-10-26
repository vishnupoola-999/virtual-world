import test from 'node:test';import assert from 'node:assert/strict';
import {sendError,checkText,mergeMsgs,lastAt,lookOf,friendsHtml,msgHtml,BLOCKED,SLOW} from '../src/threads.js';
import {activityHtml,connectedTo,incomingOf} from '../src/town.js';
test('send errors map to friendly copy',()=>{assert.equal(sendError({status:400,error:'text not allowed'}),BLOCKED);assert.equal(sendError({status:429}),SLOW);});
test('checkText limits',()=>{assert.equal(checkText(' '),'empty');assert.equal(checkText('x'.repeat(1001)),'That message is too long.');assert.equal(checkText(Array(21).fill('a').join('\n')),'Too many lines.');assert.equal(checkText('hi'),'');});
test('mergeMsgs dedupes and sorts',()=>{const m=mergeMsgs([{id:'a',at:2}],[{id:'b',at:1},{id:'a',at:2}]);assert.deepEqual(m.map(x=>x.id),['b','a']);assert.equal(lastAt(m),2);});
test('null look falls back to a creature',()=>{assert.ok(lookOf(null,'Mira').creature);});
test('friends list escapes and shows interests',()=>{const h=friendsHtml([{id:'t',with:{name:'<b>',interests:['tech','space'],look:null},last:null,unread:2}]);assert.match(h,/&lt;b&gt;/);assert.match(h,/tech · space/);assert.match(h,/frUn">2/);});
test('system message is centred line, not a bubble',()=>{assert.match(msgHtml({id:'1',from:'system',text:'x'}),/class="sys"/);assert.match(msgHtml({id:'2',from:'me',text:'y',at:0}),/msg me/);});
const F={myId:'me',mine:[{id:'m',kind:'meet',withId:'a',withName:'A',shared:['x'],at:1},{id:'n',kind:'meet',withId:'b',withName:'B',shared:['y'],at:2}],
  incoming:[{id:'p',fromName:'P',status:'pending'},{id:'d',fromName:'D',status:'declined'}],outgoing:[{toAgentId:'a',status:'accepted',threadId:'t1'},{toAgentId:'b',status:'declined'}]};
test('accept/decline only when pending; declined incoming hidden',()=>{assert.deepEqual(incomingOf(F).map(r=>r.id),['p']);const h=activityHtml(F);assert.match(h,/class="accept"/);assert.doesNotMatch(h,/>D</);});
test('sender sees Connected on accept and Request sent on decline',()=>{assert.equal(connectedTo(F).get('a'),'t1');const h=activityHtml(F);assert.match(h,/Connected · Open chat/);assert.match(h,/Request sent/);});
