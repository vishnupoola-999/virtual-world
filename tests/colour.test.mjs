import test from 'node:test';import assert from 'node:assert/strict';
import {sanitize,toLook,cleanColor,BODY_SWATCHES} from '../src/character-data.js';
test('look.color kept only as #rrggbb, lowercased',()=>{assert.equal(sanitize({creature:'drip',accessory:'none',color:'#FFAA00'}).color,'#ffaa00');assert.equal('color' in sanitize({creature:'drip',accessory:'none',color:'url(x)'}),false);assert.equal(cleanColor(null),null);});
test('toLook keeps a valid colour and drops null',()=>{assert.deepEqual(toLook({creature:'puff',accessory:'bow',color:'#123456'}),{creature:'puff',accessory:'bow',color:'#123456'});assert.deepEqual(toLook({creature:'puff',accessory:'bow',color:null}),{creature:'puff',accessory:'bow'});});
test('eight preset swatches, all valid',()=>{assert.equal(BODY_SWATCHES.length,8);for(const c of BODY_SWATCHES)assert.equal(cleanColor(c),c);});
