// Minimal brain (v1): scripted greetings + Arjun's gossip. Replaced by a richer version later.
const gossip=['said prices of tomatoes went up','saw a new café opening','heard the road will be repaired','is planning a cricket match on Sunday','says the park was crowded today','thinks it will rain tonight'];
export class Brain{constructor(env){this.env=env;}
 reset(A){this.A=A;}
 override(){return null;}
 onHour(h,{parkName}){const n=this.env.addNews;if(h==8){n('Ravi opened his shop.');n('Meera started class at school.');}if(h==17)n('Meera is tutoring kids at '+parkName+'.');if(h==21)n('Ravi closed his shop for the day.');}
 tick(){}
 meet(a,b){for(const [x,y] of [[a,b],[b,a]]){if(x.sayT>0)continue;
  if(x.role=='shopkeeper'&&x.status.includes('open')){x.say='Namaste '+y.name+'! Fresh stock today 🙂';x.sayT=3;}
  else if(x.role=='reporter'){const g=gossip[Math.floor(Math.random()*gossip.length)];x.say=y.name+', any news?';x.sayT=3;y.say='Did you know? Someone '+g;y.sayT=3;this.env.addNews(`${y.name} ${g}.`);x.route=[];x.goal=null;}}}}
