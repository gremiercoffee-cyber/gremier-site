import type {Habit} from '../../shared/daynote';
export function FollowupInput({habit,value,onChange}:{habit:Habit;value:string;onChange:(v:string)=>void}){
 if(habit.detail==='time')return <label className="dn-detail-time">Choose a time<input aria-label={habit.detailLabel||'Time'} type="time" value={value} onClick={e=>{try{e.currentTarget.showPicker?.()}catch{/* native control remains usable */}}} onChange={e=>onChange(e.target.value)}/></label>;
 const options=habit.id==='nap'?['15','30','45','60','90']:['1','2','3','4','5+'];
 const exact=value!==''&&!options.includes(value);
 return <div className="dn-detail-number"><div className="dn-detail-options" role="group" aria-label={habit.detailLabel||'Choose a number'}>{options.map(n=><button type="button" key={n} aria-pressed={value===n} onClick={()=>onChange(n)}>{n}{habit.id==='nap'?' min':''}</button>)}</div><label className="dn-detail-exact">{habit.id==='nap'?'Other duration (minutes)':'Or enter an exact number'}<input aria-label="Exact follow-up number" type="number" inputMode="numeric" min="0" max="10000" step="1" value={exact?value:''} placeholder="Other" onChange={e=>onChange(e.target.value)}/></label></div>;
}
