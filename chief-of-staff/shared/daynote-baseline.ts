import {shiftDate} from './daynote';
export type VitalMetric='hrv'|'rhr'|'resp'|'oxygen'|'temp';
export type VitalPoint={id:string;date:string;type:string;value:number;updated_at:string;device?:string};
export const vitalTypes={hrv:'daily-heart-rate-variability',rhr:'daily-resting-heart-rate',resp:'daily-respiratory-rate',oxygen:'daily-oxygen-saturation',temp:'daily-sleep-temperature-derivations'};
const median=(v:number[])=>{const s=[...v].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2;};
/** Experimental personal-range display, not a clinical risk or recovery score. */
export function vitalBaseline(metric:VitalMetric,current:VitalPoint|undefined,rows:VitalPoint[],date:string){
 if(!current)return {tone:'neutral',label:'No data',count:0};
 const source=(id:string)=>id.startsWith('takeout:google:')||id.startsWith('api:')?'google':id.startsWith('takeout:')?'other-import':'google';
 const api=(id:string)=>id.startsWith('api:')||id.startsWith('users/');
 const days=new Map<string,VitalPoint>();
 for(const p of rows)if(p.type===vitalTypes[metric]&&p.date<date&&p.date>=shiftDate(date,-28)&&Number.isFinite(p.value)&&source(p.id)===source(current.id)&&(p.device||'unknown-device')===(current.device||'unknown-device')){const old=days.get(p.date);if(!old||api(p.id)&&!api(old.id)||api(p.id)===api(old.id)&&p.updated_at>old.updated_at)days.set(p.date,p);}
 const values=[...days.values()].map(p=>p.value),count=values.length;
 if(count<14)return {tone:'neutral',label:`Learning ${count}/14 days`,count};
 const center=median(values),scale=Math.max(1.4826*median(values.map(v=>Math.abs(v-center))),{hrv:5,rhr:3,resp:1,oxygen:1,temp:.2}[metric]);
 const z=(current.value-center)/scale,abs=Math.abs(z),label=abs<.5?'Typical':z>0?'Above usual':'Below usual';
 let tone:string;
 if(metric==='hrv'||metric==='rhr'){
  const directional=metric==='hrv'?z:-z;
  tone=abs>=3?'red':directional<=-2.5?'red':directional<=-1.5?'orange':directional<=-.5?'yellow':directional>=1.5?'deep-green':'green';
 }else tone=abs>=2.5?'red':abs>=1.5?'orange':abs>=1?'yellow':abs<.5?'deep-green':'green';
 return {tone,label,count,center};
}
