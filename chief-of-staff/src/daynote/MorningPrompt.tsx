import {useState} from 'react';
import type {Journal} from '../../shared/daynote';
import {Modal} from './Modal';
import {RatingWheel} from './RatingWheel';

export function MorningPrompt({journal,onSave,onClose}:{journal:Journal;onSave:(rating:number)=>boolean;onClose:()=>void}){
 const [rating,setRating]=useState(journal.morning?.overall??null),[error,setError]=useState('');
 return <Modal label="Morning check-in" onClose={onClose} className="dn-morning-modal">
  <div className="dn-morning-sun" aria-hidden="true">☀</div>
  <p className="dn-eyebrow">MORNING CHECK-IN</p><h2>How do you feel?</h2><p className="dn-morning-intro">Thinking about your sleep and energy.</p>
  <div className="dn-rating-single"><RatingWheel label="Sleep & energy" kind="overall" value={rating} onChange={setRating}/></div>
  <p className="dn-morning-hint">Scroll to your number · 0–10</p>
  {error&&<p role="alert" className="dn-error">{error}</p>}
  <button className="dn-primary" disabled={rating===null} onClick={()=>{if(rating!==null&&!onSave(rating))setError('Could not save on this device. Please try again.');}}>Save & continue</button>
  <button className="dn-morning-later" onClick={onClose}>Skip today</button>
 </Modal>;
}
