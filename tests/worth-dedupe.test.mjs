// Agent chats: one Worth-meeting card per person (the latest), as a client-side safety net.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worthMeeting } from '../src/town.js';
test('duplicate meets with the same person collapse to the newest card', () => {
  const f = { mine: [
    { id: 'old', kind: 'meet', withId: 'h_bs', withName: 'Bs', shared: ['tech'], at: 1000 },
    { id: 'p', kind: 'meet', withId: 'h_po', withName: 'Pooja', shared: ['science'], at: 1500 },
    { id: 'new', kind: 'meet', withId: 'h_bs', withName: 'Bs', shared: ['tech', 'space'], at: 2000 },
    { id: 'n1', kind: 'meet', withName: 'Mira', shared: ['music'], at: 1100 }, { id: 'n2', kind: 'meet', withName: 'mira', shared: ['music'], at: 1200 },
    { id: 't', kind: 'meet', withId: 'town-x', withName: 'Arjun', town: true, shared: ['ai'], at: 3000 }] };
  assert.deepEqual(worthMeeting(f).map((e) => e.id), ['new', 'p', 'n2']);
});
