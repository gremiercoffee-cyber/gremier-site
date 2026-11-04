import type {Comparison} from './daynote';
export const effectReady=(c:Partial<Comparison>)=>(c.yes_n??0)>=5&&(c.no_n??0)>=5&&Number.isFinite(c.yes_mean)&&Number.isFinite(c.no_mean);
/** Conservative visual gates, not clinical benefit or causal estimates. */
export function effectTone(c:Comparison){
 if(!effectReady(c))return 0;
 if(!['hrv_ms','resting_hr'].includes(c.metric)||!Number.isFinite(c.standard_error)||!Number.isFinite(c.standardized_difference)||c.difference===null)return 0;
 const direction=c.metric==='hrv_ms'?1:-1,effect=c.difference*direction,size=Math.abs(c.standardized_difference!),n=Math.min(c.yes_n,c.no_n);
 if(Math.abs(effect)<=3*c.standard_error!||size<.2||!c.split_consistent)return 0;
 // An adjusted comparison that disagrees blocks directional coloring.
 if(c.matched_difference!==null&&Math.sign(c.matched_difference*direction)!==Math.sign(effect))return 0;
 const level=n>=14&&size>=.8&&c.label==='Reasonably consistent association'?3:n>=10&&size>=.5&&c.matched_n>=10?2:1;
 return Math.sign(effect)*level;
}
export function habitEffect(cs:Comparison[]){
 if(!cs.some(effectReady))return {tone:'collecting',label:'Collecting data'};
 const directional=cs.filter(c=>['hrv_ms','resting_hr'].includes(c.metric));
 if(directional.length<2||!directional.every(effectReady))return {tone:'neutral',label:'Not clear yet'};
 const raw=directional.map(c=>c.difference!*(c.metric==='hrv_ms'?1:-1));
 if(raw.some(v=>v>0)&&raw.some(v=>v<0))return {tone:'neutral',label:'Mixed pattern'};
 const signals=directional.map(effectTone);
 if(signals.some(v=>v>0)&&signals.some(v=>v<0))return {tone:'neutral',label:'Mixed pattern'};
 if(signals.some(v=>v===0))return {tone:'neutral',label:'Not clear yet'};
 const level=Math.min(...signals.map(Math.abs)),positive=signals[0]>0;
 return {tone:positive?`green-${level}`:['','yellow','orange','red'][level],label:positive?'Positive association':'Negative association'};
}
