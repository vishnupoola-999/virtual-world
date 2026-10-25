// Firebase (Auth + Firestore) via official CDN ESM build. Web config is public by design.
// Sign-in strategy (see README "Sign-in"): the site is on github.io but authDomain is *.firebaseapp.com, so
// signInWithRedirect breaks in browsers that partition third-party storage (Chrome 115+, Safari 16.1+, Firefox, iOS):
// the user returns from Google but getRedirectResult() finds nothing and they stay signed out. Firebase's
// "redirect best practices" Option 1 is to use signInWithPopup everywhere; we only fall back to redirect if the popup is blocked.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {initializeAuth,indexedDBLocalPersistence,browserLocalPersistence,browserPopupRedirectResolver,GoogleAuthProvider,
  signInWithPopup,signInWithRedirect,reauthenticateWithPopup,linkWithPopup,signInWithCredential,getRedirectResult,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
const app=initializeApp({apiKey:'AIzaSyCfA2MaUKk-B9L4GNpM-QJiOXp3E6UUZdM',authDomain:'virtual-world-8ac82.firebaseapp.com',projectId:'virtual-world-8ac82',storageBucket:'virtual-world-8ac82.firebasestorage.app',messagingSenderId:'38479190061',appId:'1:38479190061:web:749e619be467e076de80a4',measurementId:'G-MXK91TZGGZ'});
export const auth=initializeAuth(app,{persistence:[indexedDBLocalPersistence,browserLocalPersistence],popupRedirectResolver:browserPopupRedirectResolver});
// Firestore (~113 KB gz) is deferred (perf audit #2): loaded on first use, or after first paint when idle.
const FS_DB='default'; // Firestore database id (named 'default', not '(default)')
let fsP=null;const fs=()=>fsP||=import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js').then(m=>({...m,db:m.getFirestore(app,FS_DB)}));
(globalThis.requestIdleCallback||(f=>setTimeout(f,1500)))(()=>fs().catch(()=>{fsP=null;}),{timeout:4000});
const provider=()=>{const p=new GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});return p;};
const FRIENDLY={'auth/popup-closed-by-user':'Sign-in window was closed before finishing.','auth/cancelled-popup-request':'Sign-in already in progress.',
 'auth/unauthorized-domain':'This site is not in Firebase Authorized domains.','auth/network-request-failed':'Network problem, check your connection.',
 'auth/web-storage-unsupported':'This browser blocks storage (private mode?). Try normal Chrome/Safari.','auth/internal-error':'Google sign-in internal error, please retry.',
 'auth/user-disabled':'This account has been disabled.','auth/too-many-requests':'Too many attempts, wait a minute.',
 'auth/native-not-configured':'Native Google sign-in needs android/app/google-services.json. See the README.',
 'auth/native-developer-error':'Google rejected this app (status 10). Add the debug SHA-1 and Web client ID in Firebase. See the README.',
 'auth/native-cancelled':'Google sign-in was cancelled.',
 'auth/missing-id-token':'Google did not return an id token. Check the debug SHA-1 and Web client ID.'};
export const authMsg=e=>(FRIENDLY[e?.code]||'Sign-in failed')+(e?.code?` (${e.code})`:` (${e?.message||e})`);
// Must always be checked once on load, in case we fell back to redirect last time.
export const redirectResult=getRedirectResult(auth).then(r=>{sessionStorage.removeItem('vw-redirect');return r;})
  .catch(e=>{sessionStorage.removeItem('vw-redirect');throw e;});
let busy=false;
// Android WebView rejects Google OAuth (403 disallowed_useragent). The Capacitor bridge is injected
// only in the native app, so browsers never enter this path. skipNativeAuth returns a Google id token;
// the Firebase JS SDK signs in with it and Firestore keeps using the same web user.
function nativeCap(){
  const cap=globalThis.Capacitor;
  return cap&&typeof cap.isNativePlatform==='function'&&cap.isNativePlatform()?cap:null;
}
function nativeAuthError(e){
  const code=e?.code||'',message=e?.message||String(e??'Native Google sign-in failed');
  const text=`${code} ${message}`;
  if(/UNIMPLEMENTED|not implemented|plugin is not|FirebaseApp is not initialized|google-services/i.test(text)){
    const err=new Error(FRIENDLY['auth/native-not-configured']);err.code='auth/native-not-configured';return err;}
  if(/\b12501\b|SIGN_IN_CANCELLED/.test(text)){
    const err=new Error(FRIENDLY['auth/native-cancelled']);err.code='auth/native-cancelled';return err;}
  if(/\b10:|DEVELOPER_ERROR|WILL_BE_OVERRIDDEN/.test(text)){
    const err=new Error(FRIENDLY['auth/native-developer-error']);err.code='auth/native-developer-error';return err;}
  if(FRIENDLY[code])return e;
  return Object.assign(new Error(message),{cause:e});
}
async function signInNative(cap){
  if(typeof cap.nativePromise!=='function')throw nativeAuthError({code:'UNIMPLEMENTED',message:'Capacitor bridge has no nativePromise'});
  let result;
  try{result=await cap.nativePromise('FirebaseAuthentication','signInWithGoogle',{skipNativeAuth:true});}
  catch(e){throw nativeAuthError(e);}
  const idToken=result?.credential?.idToken;
  if(!idToken)throw Object.assign(new Error(FRIENDLY['auth/missing-id-token']),{code:'auth/missing-id-token'});
  return signInWithCredential(auth,GoogleAuthProvider.credential(idToken));
}
export async function signIn(){
  const cap=nativeCap();
  if(cap){if(busy)return;busy=true;try{return await signInNative(cap);}finally{busy=false;}}
  if(busy)return;busy=true;
  try{return await signInWithPopup(auth,provider());}
  catch(e){if(e.code==='auth/popup-blocked'||e.code==='auth/operation-not-supported-in-environment'){sessionStorage.setItem('vw-redirect','1');return signInWithRedirect(auth,provider());}throw e;}
  finally{busy=false;}}
export async function logOut(){
  try{const u=auth.currentUser;if(u)localStorage.removeItem('vw-agent:'+u.uid);}catch(e){}
  const cap=nativeCap();
  if(cap&&typeof cap.nativePromise==='function'){
    try{await cap.nativePromise('FirebaseAuthentication','signOut',{});}
    catch(e){console.warn('native signOut:',e?.message||e);}
  }
  return signOut(auth);
}
export const onUser=cb=>onAuthStateChanged(auth,cb);
// Fast agent load (fix/fast-agent-load): on some mobile networks the SDK's streaming channel stalls and getDoc only gives up
// with "unavailable" after ~30 s, and we retried that 3 times (about a minute). The REST API is one plain HTTPS GET, so try it first
// (same Firestore rules, using the user's ID token), and fall back to the SDK with its own time limit.
const PROJ='virtual-world-8ac82';
const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,no)=>setTimeout(()=>no(Object.assign(new Error('timeout'),{code:'deadline-exceeded'})),ms))]);
export const fromRest=v=>v==null?null:'stringValue' in v?v.stringValue:'doubleValue' in v?v.doubleValue:'integerValue' in v?Number(v.integerValue)
  :'booleanValue' in v?v.booleanValue:'nullValue' in v?null:'timestampValue' in v?v.timestampValue:'mapValue' in v?fromRestFields(v.mapValue.fields||{})
  :'arrayValue' in v?(v.arrayValue.values||[]).map(fromRest):null;
const fromRestFields=f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,fromRest(v)]));
async function loadAgentRest(uid){const u=auth.currentUser;if(!u||u.uid!==uid)throw new Error('no user');const t=await u.getIdToken();
  const r=await fetch(`https://firestore.googleapis.com/v1/projects/${PROJ}/databases/${FS_DB}/documents/agents/${encodeURIComponent(uid)}`,{headers:{Authorization:'Bearer '+t}});
  if(r.status===404)return null;if(!r.ok)throw Object.assign(new Error('REST '+r.status),{code:'rest-'+r.status});return fromRestFields((await r.json()).fields||{});}
async function loadAgentSdk(uid){const {getDoc,doc,db}=await fs();const s=await getDoc(doc(db,'agents',uid));return s.exists()?s.data():null;}
export async function loadAgent(uid){let a;try{a=await withTimeout(loadAgentRest(uid),8000);}catch{a=await withTimeout(loadAgentSdk(uid),12000);}cacheAgent(uid,a);return a;}
// Last known agent per uid, so a returning user sees their agent at once while Firestore confirms it.
const CK=uid=>'vw-agent:'+uid;
export function cachedAgent(uid){try{return JSON.parse(localStorage.getItem(CK(uid))||'null');}catch{return null;}}
export function cacheAgent(uid,a){try{if(a)localStorage.setItem(CK(uid),JSON.stringify({...a,updatedAt:null,memory:undefined}));else localStorage.removeItem(CK(uid));}catch{/* storage full or blocked */}}
// ~1 km grid (0.01°) for the future friends phase; exact coords stay owner-only.
const r2=x=>Math.round(x*100)/100;
export async function saveAgent(uid,a){const {setDoc,doc,db,serverTimestamp}=await fs();const d={name:a.name,look:a.look,personality:a.personality||'',ownerName:a.ownerName||'',lat:a.lat,lon:a.lon,
  approx:{lat:r2(a.lat),lon:r2(a.lon)},spotApprox:!!a.spotApprox,preciseVisibility:'private',updatedAt:serverTimestamp()};
  // merge keeps the server-written `memory` field (rules reject any client change to it).
  await setDoc(doc(db,'agents',uid),d,{merge:true});
  // merge keeps interests/bio already stored. The payload omits them, so keep the cached copy.
  const prev=cachedAgent(uid);if(prev?.interests&&d.interests==null)d.interests=prev.interests;if(typeof prev?.bio==='string'&&d.bio==null)d.bio=prev.bio;
  cacheAgent(uid,d);return d;}
// Chat history: agents/{uid}/messages, owner-only. Kept to the newest MAX_MESSAGES.
// Life loop profile: 3-5 interest tags and a one-line bio (rules enforce the same limits). UI is owned by design.
export function cleanInterests(list){const out=[];for(const t of Array.isArray(list)?list:[]){if(typeof t!=='string')continue;const g=t.trim().toLowerCase().replace(/\s+/g,' ');if(/^[a-z0-9][a-z0-9 &+-]{0,23}$/.test(g)&&!out.includes(g))out.push(g);}return out.slice(0,5);}
// proxy/life.js DEFAULT_INTERESTS, applied in memory for the life loop only. Not a saved profile.
const BRAIN_DEFAULT_INTERESTS=['exploring','meeting people'];
export function realSavedInterests(list){const tags=cleanInterests(list);
  if(tags.length===BRAIN_DEFAULT_INTERESTS.length&&BRAIN_DEFAULT_INTERESTS.every(t=>tags.includes(t)))return [];
  return tags;}
export async function saveInterests(uid,interests,bio=''){const tags=cleanInterests(interests);if(tags.length<3||realSavedInterests(tags).length<3)throw new Error('Pick 3 to 5 interests');
  const {updateDoc,doc,db,serverTimestamp}=await fs();const d={interests:tags,bio:String(bio).replace(/\s+/g,' ').trim().slice(0,80),updatedAt:serverTimestamp()};
  await updateDoc(doc(db,'agents',uid),d);return d;}
// Life loop diary (owner-read-only): newest first. Entries: {kind:'meet'|'diary', text?, withId?, withName?, shared?, at}.
export async function loadDiary(uid,n=30){const F=await fs(),{getDocs,query,orderBy,limit,collection,db}=F;
  const s=await getDocs(query(collection(db,'agents',uid,'diary'),orderBy('at','desc'),limit(n)));return s.docs.map(d=>({id:d.id,...d.data()}));}
export const MAX_MESSAGES=200;
const msgs=({collection,db},uid)=>collection(db,'agents',uid,'messages');
export async function loadMessages(uid){const F=await fs(),{getDocs,query,orderBy,limit}=F;const s=await getDocs(query(msgs(F,uid),orderBy('at','desc'),limit(MAX_MESSAGES)));
  return s.docs.map(d=>d.data()).filter(m=>m&&(m.role==='user'||m.role==='assistant')&&typeof m.content==='string').reverse().map(m=>({role:m.role,content:m.content}));}
export async function addMessage(uid,m){const F=await fs();return F.addDoc(msgs(F,uid),{role:m.role,content:String(m.content).slice(0,2000),at:F.serverTimestamp()});}
export async function trimMessages(uid){const F=await fs(),{getDocs,query,orderBy,limit,deleteDoc}=F;const s=await getDocs(query(msgs(F,uid),orderBy('at','desc'),limit(MAX_MESSAGES+100)));
  await Promise.all(s.docs.slice(MAX_MESSAGES).map(d=>deleteDoc(d.ref)));}
export const currentUser=()=>auth.currentUser;
// Agent tools: asks Google for extra scopes on demand and returns the OAuth access token.
// The token is returned to src/google-tools.js, which keeps it in memory only. It is never stored here.
export async function requestGoogleAccess(scopes){
  const u=auth.currentUser;if(!u)throw Object.assign(new Error('not signed in'),{code:'auth/no-user'});
  const p=new GoogleAuthProvider();for(const s of scopes)p.addScope(s);p.setCustomParameters({login_hint:u.email||'',include_granted_scopes:'true'});
  const hasGoogle=u.providerData.some(d=>d.providerId==='google.com');
  const r=hasGoogle?await reauthenticateWithPopup(u,p):await linkWithPopup(u,p);
  const c=GoogleAuthProvider.credentialFromResult(r);
  return {accessToken:c?.accessToken||null,expiresIn:3000};
}
