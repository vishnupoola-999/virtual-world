import test from 'node:test';import assert from 'node:assert/strict';
import {sendError,checkText,mergeMsgs,lastAt,lookOf,friendsHtml,msgHtml,BLOCKED,SLOW} from '../src/threads.js';
import {activityHtml,connectedTo,incomingOf} from '../src/town.js';
test('send errors map to friendly copy',()=>{assert.equal(sendError({status:400,error:'text not allowed'}),BLOCKED);assert.equal(sendError({status:429}),SLOW);});
test('checkText limits',()=>{assert.equal(checkText(' '),'empty');assert.equal(checkText('x'.repeat(1001)),'That message is too long.');assert.equal(checkText(Array(21).fill('a').join('\n')),'Too many lines.');assert.equal(checkText('hi'),'');});
test('mergeMsgs dedupes and sorts',()=>{const m=mergeMsgs([{id:'a',at:2}],[{id:'b',at:1},{id:'a',at:2}]);assert.deepEqual(m.map(x=>x.id),['b','a']);assert.equal(lastAt(m),2);});
test('null look falls back to a creature',()=>{assert.ok(lookOf(null,'Mira').creature);});
test('friends list escapes and shows interests',()=>{const h=friendsHtml([{id:'t',with:{name:'<b>',interests:['tech','space'],look:null},last:null,unread:2}]);assert.match(h,/&lt;b&gt;/);assert.match(h,/tech · space/);assert.match(h,/2 unread/);});
test('system message is centred line, not a bubble',()=>{assert.match(msgHtml({id:'1',from:'system',text:'x'}),/class="sys"/);assert.match(msgHtml({id:'2',from:'me',text:'y',at:0}),/msg me/);});
const F={myId:'me',mine:[{id:'m',kind:'meet',withId:'a',withName:'A',shared:['x'],at:1},{id:'n',kind:'meet',withId:'b',withName:'B',shared:['y'],at:2}],
  incoming:[{id:'p',fromName:'P',status:'pending'},{id:'d',fromName:'D',status:'declined'}],outgoing:[{toAgentId:'a',status:'accepted',threadId:'t1'},{toAgentId:'b',status:'declined'}]};
test('v4: Requests card only for pending; declined incoming hidden',()=>{assert.deepEqual(incomingOf(F).map(r=>r.id),['p']);const h=activityHtml(F);assert.match(h,/class="reqCard"/);assert.match(h,/P wants to say hi/);assert.doesNotMatch(h,/D wants/);});
test('v4: accepted shows Connected · Open chat (status+threadId or a thread), declined stays Hi sent',()=>{assert.equal(connectedTo(F).get('a'),'t1');const h=activityHtml(F);assert.match(h,/class="fr" data-thread="t1"/);assert.doesNotMatch(h,/wmRow[^>]*data-with="a"/);/* Diggy fix 3: accepted = Friend */assert.match(h,/>Hi sent</);assert.doesNotMatch(h,/declin/i);
  const viaThread=activityHtml({...F,outgoing:[{toAgentId:'b',status:'pending'}]},{threads:[{id:'t9',with:{id:'a',name:'A'}}]});assert.match(viaThread,/Friends/);assert.doesNotMatch(viaThread,/data-with="a"/);});
test('v4: section order and honest end state',()=>{const h=activityHtml(F,{threads:[{id:'t2',with:{id:'z',name:'Z'}}]});const i=k=>h.indexOf(k);assert.ok(i('reqCard')<i('Friends')&&i('Friends')<i('Worth meeting')&&i('Worth meeting')<i('All caught up'));
  assert.match(activityHtml({mine:[]}),/No chats yet/);assert.match(activityHtml({mine:[]},{threadsErr:true}),/Couldn't load chats/);});
import {groupMsgs,openers,metLine,presenceOf} from '../src/threads.js';
test('v4: grouping within 5 min, stamps on gaps',()=>{const g=groupMsgs([{id:1,from:'them',at:0},{id:2,from:'them',at:60000},{id:3,from:'me',at:70000},{id:4,from:'me',at:70000+400000}]);assert.deepEqual(g.map(x=>[x.first,x.stamp]),[[true,false],[false,false],[true,false],[true,true]]);});
test('v4: openers from shared interests, header line only from real data',()=>{assert.equal(openers(['space']).length,3);assert.match(openers(['space'])[0],/space/);
  assert.equal(metLine({with:{interests:['x']}},['y']),'');assert.match(metLine({with:{interests:['Space','art']}},['space']),/Both like <b>Space<\/b>/);
  assert.match(metLine({metAt:Date.now()-2*86400000,sharedInterests:['music'],with:{}},[]),/Met 2 days ago · Both like <b>music/);});
test('v4: presence is feature-detected, never invented',()=>{assert.deepEqual(presenceOf({}),{});assert.deepEqual(presenceOf({typing:true,theirReadAt:5}),{typing:true,readAt:5});assert.equal(presenceOf({theirReadAt:5,readReceipts:false}).readAt,undefined);
  const now=Date.now();const p=presenceOf({typingUntil:now+5000,receipts:true,seenUpTo:7,messages:[]});assert.equal(p.typing,true);assert.equal(p.readAt,7);
  assert.equal(presenceOf({typingUntil:0,receipts:true,seenUpTo:null,messages:[]}).typing,false);assert.equal(presenceOf({typingUntil:0,receipts:true,seenUpTo:null,messages:[]}).readAt,undefined);
  assert.equal(presenceOf({receipts:false,seenUpTo:null,messages:[{from:'me',status:'sent',at:9}]}).readAt,undefined);
  assert.equal(presenceOf({receipts:true,seenUpTo:null,messages:[{from:'me',status:'seen',at:9},{from:'them',status:'seen',at:99}]}).readAt,9);});

import {normRx,toggleRx,rxHtml,rxStore} from '../src/threads.js';
test('reactions (#59): normalise server shape, toggle mine, badge markup', () => {
  assert.equal(normRx(null), null); assert.equal(normRx({ heart: 0, mine: false }), null); assert.equal(normRx('x'), null);
  assert.deepEqual(normRx({ heart: '3', mine: true }), { heart: 3, mine: true }); assert.deepEqual(normRx({ heart: 0, mine: true }), { heart: 1, mine: true });
  assert.deepEqual(toggleRx(null), { heart: 1, mine: true }); assert.deepEqual(toggleRx({ heart: 1, mine: false }), { heart: 2, mine: true });
  assert.deepEqual(toggleRx({ heart: 2, mine: true }), { heart: 1, mine: false });
  assert.equal(rxHtml(null), ''); assert.match(rxHtml({ heart: 1, mine: true }), /class="rx mine"/); assert.doesNotMatch(rxHtml({ heart: 1, mine: false }), /mine|<b>/);
  assert.match(rxHtml({ heart: 2, mine: false }, true), /class="rx pop n".*<b>2<\/b>/);
});
test('reactions: old local store is read defensively', () => {
  const ls = globalThis.localStorage; const store = {}; globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
  try { store['vw-rx'] = '{bad'; assert.equal(rxStore().size, 0); store['vw-rx'] = '{"a":1}'; assert.equal(rxStore().size, 0); store['vw-rx'] = '["t|1",2]'; assert.deepEqual([...rxStore()], ['t|1']); }
  finally { globalThis.localStorage = ls; }
});
