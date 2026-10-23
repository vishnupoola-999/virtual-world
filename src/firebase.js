// Firebase (Auth + Firestore) via official CDN ESM build. Web config is public by design.
// Sign-in strategy (see README "Sign-in"): the site is on github.io but authDomain is *.firebaseapp.com, so
// signInWithRedirect breaks in browsers that partition third-party storage (Chrome 115+, Safari 16.1+, Firefox, iOS):
// the user returns from Google but getRedirectResult() finds nothing and they stay signed out. Firebase's
// "redirect best practices" Option 1 is to use signInWithPopup everywhere; we only fall back to redirect if the popup is blocked.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {initializeAuth,indexedDBLocalPersistence,browserLocalPersistence,browserPopupRedirectResolver,GoogleAuthProvider,
  signInWithPopup,signInWithRedirect,getRedirectResult,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const app=initializeApp({apiKey:'AIzaSyCfA2MaUKk-B9L4GNpM-QJiOXp3E6UUZdM',authDomain:'virtual-world-8ac82.firebaseapp.com',projectId:'virtual-world-8ac82',storageBucket:'virtual-world-8ac82.firebasestorage.app',messagingSenderId:'38479190061',appId:'1:38479190061:web:749e619be467e076de80a4',measurementId:'G-MXK91TZGGZ'});
export const auth=initializeAuth(app,{persistence:[indexedDBLocalPersistence,browserLocalPersistence],popupRedirectResolver:browserPopupRedirectResolver});
const db=getFirestore(app);
const provider=()=>{const p=new GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});return p;};
const FRIENDLY={'auth/popup-closed-by-user':'Sign-in window was closed before finishing.','auth/cancelled-popup-request':'Sign-in already in progress.',
 'auth/unauthorized-domain':'This site is not in Firebase Authorized domains.','auth/network-request-failed':'Network problem, check your connection.',
 'auth/web-storage-unsupported':'This browser blocks storage (private mode?). Try normal Chrome/Safari.','auth/internal-error':'Google sign-in internal error, please retry.',
 'auth/user-disabled':'This account has been disabled.','auth/too-many-requests':'Too many attempts, wait a minute.'};
export const authMsg=e=>(FRIENDLY[e?.code]||'Sign-in failed')+(e?.code?` (${e.code})`:` (${e?.message||e})`);
// Must always be checked once on load, in case we fell back to redirect last time.
export const redirectResult=getRedirectResult(auth).then(r=>{sessionStorage.removeItem('vw-redirect');return r;})
  .catch(e=>{sessionStorage.removeItem('vw-redirect');throw e;});
let busy=false;
export async function signIn(){if(busy)return;busy=true;
  try{return await signInWithPopup(auth,provider());}
  catch(e){if(e.code==='auth/popup-blocked'||e.code==='auth/operation-not-supported-in-environment'){sessionStorage.setItem('vw-redirect','1');return signInWithRedirect(auth,provider());}throw e;}
  finally{busy=false;}}
export const logOut=()=>signOut(auth);
export const onUser=cb=>onAuthStateChanged(auth,cb);
export async function loadAgent(uid){const s=await getDoc(doc(db,'agents',uid));return s.exists()?s.data():null;}
// ~1 km grid (0.01°) for the future friends phase; exact coords stay owner-only.
const r2=x=>Math.round(x*100)/100;
export async function saveAgent(uid,a){const d={name:a.name,look:a.look,personality:a.personality||'',ownerName:a.ownerName||'',lat:a.lat,lon:a.lon,
  approx:{lat:r2(a.lat),lon:r2(a.lon)},preciseVisibility:'private',updatedAt:serverTimestamp()};
  await setDoc(doc(db,'agents',uid),d);return d;}
