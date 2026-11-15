export type InboxDecision = 'today' | 'later' | 'dismiss';
export interface InboxReviewEntry {
  id: string;
  source: 'gmail' | 'whatsapp';
  account: string;
  sender: string;
  title: string;
  excerpt: string;
  received_at: string;
  link: string | null;
}
export interface InboxReview {
  day: string | null;
  coverage: string[];
  entries: InboxReviewEntry[];
}
