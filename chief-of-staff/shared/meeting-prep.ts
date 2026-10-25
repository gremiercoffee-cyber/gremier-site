export interface PrepMeeting {
 id:string; title:string; starts_at:string; source:'calendar'|'schedule'; location:string|null; available?:boolean;
}
export interface PrepNote {id:string; meeting_id:string; text:string; created_at:string}
export interface PrepDraft {id:string; text:string; candidates:PrepMeeting[]; created_at:string}
export interface MeetingPrepState {meetings:PrepMeeting[]; notes:PrepNote[]; drafts:PrepDraft[]; timezone:string}
