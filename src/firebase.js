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
let fsP=null;const fs=()=>fsP||=import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js').then(m=>({...m,db:m.getFirestore(app)}));
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
  const cap=nativeCap();
  if(cap&&typeof cap.nativePromise==='function'){
    try{await cap.nativePromise('FirebaseAuthentication','signOut',{});}
    catch(e){console.warn('native signOut:',e?.message||e);}
  }
  return signOut(auth);
}
export const onUser=cb=>onAuthStateChanged(auth,cb);
export async function loadAgent(uid){const {getDoc,doc,db}=await fs();const s=await getDoc(doc(db,'agents',uid));return s.exists()?s.data():null;}
// ~1 km grid (0.01°) for the future friends phase; exact coords stay owner-only.
const r2=x=>Math.round(x*100)/100;
export async function saveAgent(uid,a){const {setDoc,doc,db,serverTimestamp}=await fs();const d={name:a.name,look:a.look,personality:a.personality||'',ownerName:a.ownerName||'',lat:a.lat,lon:a.lon,
  approx:{lat:r2(a.lat),lon:r2(a.lon)},spotApprox:!!a.spotApprox,preciseVisibility:'private',updatedAt:serverTimestamp()};
  // merge keeps the server-written `memory` field (rules reject any client change to it).
  await setDoc(doc(db,'agents',uid),d,{merge:true});return d;}
// Chat history: agents/{uid}/messages, owner-only. Kept to the newest MAX_MESSAGES.
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
