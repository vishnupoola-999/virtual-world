// Creature look data with no three.js dependency, so the app shell can pick, validate and migrate looks before three.js loads.
// A look is {creature, accessory} (design/creatures-v2-notes.md). Older saved looks still load: see toLook().
export const CREATURES = ['blob','puff','sprout','pebble','drip','mallow'];
export const CREATURE_COLOURS = {blob:'#6e9bff',puff:'#a98bff',sprout:'#4fd69c',pebble:'#ff8a6b',drip:'#ffc24a',mallow:'#45c8d8'};
export const ACCESSORIES = ['none','glasses','beanie','tuft','headphones','bow'];
export const ACC_LABEL = {none:'None',glasses:'Glasses',beanie:'Beanie',tuft:'Tuft',headphones:'Headphones',bow:'Bow'};
export const isCreature = (c) => CREATURES.includes(c);
export const isCreatureLook = (l) => !!l && typeof l === 'object' && isCreature(l.creature);
// The only shape ever saved: exactly {creature, accessory}.
export function sanitize(l){return {creature:isCreature(l?.creature)?l.creature:'blob',accessory:ACCESSORIES.includes(l?.accessory)?l.accessory:'none'};}
export const defaultLook = (creature='blob') => sanitize({creature});

const HEX=/^#[0-9a-f]{6}$/i;
const rgb=(h)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
// Nearest creature colour to a hex (legacy outfit colours and {color} looks).
export function nearestCreature(hex){if(!HEX.test(hex||''))return null;const [r,g,b]=rgb(hex);let best='blob',bd=Infinity;
  for(const c of CREATURES){const [R,G,B]=rgb(CREATURE_COLOURS[c]),d=(r-R)**2+(g-G)**2+(b-B)**2;if(d<bd){bd=d;best=c;}}return best;}
// v1 human outfit colours, mapped by hand so each one lands on the creature that reads as "the same" colour.
const OUTFIT_TO = {'#1e88e5':'blob','#ff7043':'pebble','#3ddc97':'sprout','#ffc861':'drip','#e25d9b':'puff','#7e57c2':'puff','#eef2ff':'mallow','#26324f':'blob'};
const ACC_TO = {glasses:'glasses',headphones:'headphones',cap:'beanie',bindi:'bow'};
const hash = (s) => [...String(s)].reduce((h,c)=>(Math.imul(h,31)+c.charCodeAt(0))>>>0,7);
// Old v1 human look {v:1, base, outfitColour, acc[]} -> creature look. Pure, unit tested.
export function migrateHuman(l){const oc=String(l.outfitColour||'').toLowerCase();
  const creature=OUTFIT_TO[oc]||nearestCreature(oc)||(l.base==='girl'?'puff':'blob');
  const a=(Array.isArray(l.acc)?l.acc:[]).map(x=>ACC_TO[x]).find(Boolean)||'none';return {creature,accessory:a};}
// Town characters from /feed: look {seed, colorIndex}. Same creature and accessory on every device. Pure, unit tested.
export function townLook(t){const ci=Number.isInteger(t?.colorIndex)?((t.colorIndex%8)+8)%8:0,seed=Number.isFinite(+t?.seed)?(+t.seed>>>0):ci*2654435761>>>0;
  let h=(seed^Math.imul(ci+1,0x9e3779b1))>>>0; // murmur3 fmix32, so nearby seeds still spread across all six
  h^=h>>>16;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);h^=h>>>16;h>>>=0;
  return {creature:CREATURES[h%CREATURES.length],accessory:ACCESSORIES[(h>>>16)%ACCESSORIES.length]};}
// Any stored look (creature, v1 human, legacy {color,emoji}, town {seed,colorIndex}, or nothing) -> a valid creature look.
export function toLook(look,name=''){
  if(isCreatureLook(look))return sanitize(look);
  if(look?.v===1&&(look.base==='girl'||look.base==='boy'))return migrateHuman(look);
  if(look&&Number.isInteger(look.colorIndex))return townLook(look);
  const c=nearestCreature(look?.color);if(c)return {creature:c,accessory:'none'};
  if(look?.base==='girl')return {creature:'puff',accessory:'none'};
  return {creature:CREATURES[hash(name||'agent')%CREATURES.length],accessory:'none'};}
