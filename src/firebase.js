// Firebase (Auth + Firestore) via official CDN ESM build. Web config is public by design.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,getRedirectResult,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const app=initializeApp({apiKey:'AIzaSyCfA2MaUKk-B9L4GNpM-QJiOXp3E6UUZdM',authDomain:'virtual-world-8ac82.firebaseapp.com',projectId:'virtual-world-8ac82',storageBucket:'virtual-world-8ac82.firebasestorage.app',messagingSenderId:'38479190061',appId:'1:38479190061:web:749e619be467e076de80a4',measurementId:'G-MXK91TZGGZ'});
export const auth=getAuth(app);const db=getFirestore(app);
getRedirectResult(auth).catch(e=>console.warn('redirect:',e.code));
const mobile=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
export async function signIn(){const p=new GoogleAuthProvider();
  if(mobile)return signInWithRedirect(auth,p);
  try{await signInWithPopup(auth,p);}catch(e){if(['auth/popup-blocked','auth/operation-not-supported-in-environment'].includes(e.code))return signInWithRedirect(auth,p);throw e;}}
export const logOut=()=>signOut(auth);
export const onUser=cb=>onAuthStateChanged(auth,cb);
export async function loadAgent(uid){const s=await getDoc(doc(db,'agents',uid));return s.exists()?s.data():null;}
// ~1 km grid (0.01°) for the future friends phase; exact coords stay owner-only.
const r2=x=>Math.round(x*100)/100;
export async function saveAgent(uid,a){const d={name:a.name,look:a.look,personality:a.personality,ownerName:a.ownerName,lat:a.lat,lon:a.lon,
  approx:{lat:r2(a.lat),lon:r2(a.lon)},preciseVisibility:'private',updatedAt:serverTimestamp()};
  await setDoc(doc(db,'agents',uid),d);return d;}
