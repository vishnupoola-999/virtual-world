// Display names. Built-in town agents arrive as "Coder Arjun (town)": users see just "Arjun", never the "(town)" tag.
export const isTownName=n=>/\(town\)\s*$/i.test(String(n||''));
export function displayName(n){const s=String(n||'').replace(/\s+/g,' ').trim();if(!isTownName(s))return s;
  const w=s.replace(/\s*\(town\)\s*$/i,'').trim().split(' ');return w[w.length-1]||'a neighbour';}
// "With Coder Arjun (town)" -> "Chatting with Arjun"; other labels only lose the tag.
export const displayLabel=l=>String(l||'').replace(/^With (.+)$/i,(_,n)=>`Chatting with ${displayName(n)}`).replace(/\s*\(town\)/gi,'');
