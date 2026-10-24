// Character look data with no three.js dependency, so the app shell can pick/validate looks before three.js is lazy-loaded.
export const SKIN = ['#f6d7c3','#eec1a0','#d9a07a','#c08560','#9a6544','#6e4630'];
export const HAIR_COLOURS = ['#1b1512','#3b2618','#6b4226','#a8743f','#c9c2b8','#6d3fc0'];
export const OUTFIT_COLOURS = ['#1e88e5','#ff7043','#3ddc97','#ffc861','#e25d9b','#7e57c2','#eef2ff','#26324f'];
export const HAIRSTYLES = { boy:['short','spiky','curly','buzz'], girl:['long','ponytail','bun','bob','curly','short'] };
export const OUTFITS = { boy:['tee','hoodie','kurta'], girl:['tee','hoodie','kurta','dress'] }; // boy kurta = straight men's cut with collar
export const ACCESSORIES = { boy:['none','glasses','headphones','cap'], girl:['none','glasses','headphones','cap','bindi'] };
// Keep a look valid for its base (used when switching Girl/Boy)
export function sanitize(l){const b=l.base,d=defaultLook(b);return {...l,hair:HAIRSTYLES[b].includes(l.hair)?l.hair:d.hair,outfit:OUTFITS[b].includes(l.outfit)?l.outfit:d.outfit,acc:(l.acc||[]).filter(a=>ACCESSORIES[b].includes(a))};}

export function defaultLook(base='girl'){
  return base==='boy'
    ? {v:1,base:'boy', skin:SKIN[2],hair:'short',hairColour:HAIR_COLOURS[0],outfit:'tee',  outfitColour:OUTFIT_COLOURS[0],bottomColour:'#26324f',acc:[]}
    : {v:1,base:'girl',skin:SKIN[2],hair:'long', hairColour:HAIR_COLOURS[0],outfit:'dress',outfitColour:OUTFIT_COLOURS[1],bottomColour:'#26324f',acc:[]};
}

// Name -> default base. Only a starting guess: the user can switch instantly.
const GIRL=new Set('srilatha lakshmi priya divya swathi kavya sneha anjali pooja keerthi sravani sindhu harika bhavana deepika lavanya meghana mounika navya pallavi ramya sahithi sai_priya shreya sowmya spandana tejaswini vaishnavi varsha akhila alekhya anusha aparna archana bindu chandana gayathri haritha jyothi kalyani lahari madhuri manasa nandini nikitha padma prathyusha radhika rekha roja sangeetha sirisha soujanya sushma tanvi usha vani vidya yamini aishwarya ananya diya isha kriti meera neha riya saanvi tara zara fatima ayesha sana mary'.split(' '));
const BOY=new Set('vishnu krishna rama siva shiva surya aditya chaitanya ravi hari sai rahul arjun karthik naveen praveen sandeep srinivas suresh ramesh mahesh rajesh venkat venkatesh vamshi vamsi akhil anil sunil kiran manikanta nikhil pavan prasad raju rakesh sai_kumar sathish shiva tarun teja uday varun vijay yashwanth abhishek ajay amit arun ashok bharath charan dinesh ganesh gopal harsha jagan kalyan kishore lokesh madhu mohan nagaraju nitin pranav rohit sachin sanjay sravan sudheer vinay vivek yash aarav vihaan reyansh ayaan mohammed imran john joseph'.split(' '));
// names that look 'female' by suffix but are usually male in Telugu/Indian usage
const MALE_A=/(krishna|rama|surya|aditya|chaitanya|siva|shiva|ganga?dhar|ramana|sudha?kar|bhaskara|eswara|narasimha|anantha|balarama|harsha|teja|ravi|hari|sai|mani|murali|bali|giri)$/;
export function guessBase(fullName=''){
  const first=(fullName.trim().toLowerCase().split(/[\s.]+/).find(w=>w.length>1)||'').replace(/[^a-z]/g,'');
  if(!first)return {base:'girl',confidence:0};
  if(GIRL.has(first))return {base:'girl',confidence:.95};
  if(BOY.has(first))return {base:'boy',confidence:.95};
  if(MALE_A.test(first))return {base:'boy',confidence:.7};
  if(/(a|aa|i|ee|ya|vi|mi|ini|ika|itha|atha|thi|shri|sri)$/.test(first))return {base:'girl',confidence:.6};
  if(/(esh|ash|ith|it|an|ar|al|ul|ush|ay|av|raj|deep|kumar|reddy|u)$/.test(first))return {base:'boy',confidence:.6};
  return {base:'boy',confidence:.4};
}
const HEX=/^#[0-9a-f]{6}$/i;
// Agents saved before v1 looks only have {color,emoji}: start from the name's default base and keep their colour as the outfit.
export function toLook(look,name=''){
  if(look?.v===1&&(look.base==='girl'||look.base==='boy'))return sanitize({...defaultLook(look.base),...look});
  const l=defaultLook(guessBase(name).base);if(HEX.test(look?.color||''))l.outfitColour=look.color.toLowerCase();return l;}
