import type {NightScore} from './daynote-scores';

/** Descriptive outlier rule, NOT a validated infection prediction model. Only
 * same-source baselines with 14 prior nights are provided by scoreNight. */
export function unusualVitals(night:NightScore|null){
 const names:Record<string,string>={hrv:'HRV',rhr:'resting heart rate',resp:'breathing rate',temp:'skin temperature'};
 const signals=(night?.body_components||[]).filter(c=>['hrv','rhr','resp','temp'].includes(c.key)&&c.count>=14&&Number.isFinite(c.z)&&c.value!==null&&(c.key==='hrv'?c.z!<=-2:c.z!>=2));
 // HRV and RHR are related; require a temperature or breathing change as well.
 if(signals.length<2||!signals.some(c=>c.key==='resp'||c.key==='temp'))return null;
 return {date:night!.date,metrics:signals.map(c=>names[c.key]),message:'Several readings are outside your usual range. Poor sleep, stress, exercise, alcohol or illness can cause this. Check how you feel; this does not predict or diagnose illness.'};
}

export const DAYNOTE_NOTIFICATION_DEFAULTS={reminders:false,reminder_time:'23:45',morning_reminders:false,morning_time:'09:00',health_alerts:false,weekly_summary:false,wake_time:null as string|null};
export type DaynotePreferences=typeof DAYNOTE_NOTIFICATION_DEFAULTS;
