export interface ShoppingItem {
  id: string; list_id: string; name: string; quantity: string; notes: string;
  checked: number; checked_at: string | null; source: string; created_at: string; updated_at: string;
}
export interface ShoppingList { id: string; name: string; items: ShoppingItem[] }
export interface ShoppingConfig { enabled: boolean; chat: string; chat_id: string }
export interface ShoppingState { lists: ShoppingList[]; config: ShoppingConfig; pending: number }

export const PURCHASE_VISIBLE_MS = 24 * 60 * 60 * 1000;
/** Rolling 24 hours from checking off; archive is a view, never a deletion. */
export function shoppingSections(items: ShoppingItem[], at = Date.now()) {
  const needed: ShoppingItem[] = [], recent: ShoppingItem[] = [], archived: ShoppingItem[] = [];
  for (const item of items) {
    if (!item.checked) needed.push(item);
    else if (Date.parse(item.checked_at ?? item.updated_at) + PURCHASE_VISIBLE_MS > at) recent.push(item);
    else archived.push(item);
  }
  return {needed,recent,archived};
}

// Match the configured conversation, never the message's sender or a group participant.
export function isShoppingChat(c: ShoppingConfig, m: { account?: string; chat?: string; chatId?: string; isGroup?: boolean }): boolean {
  if (!c.enabled || m.account !== 'personal' || m.isGroup !== false || !m.chatId || m.chatId.endsWith('@g.us')) return false;
  if (!/@(c\.us|s\.whatsapp\.net|lid)$/.test(m.chatId)) return false;
  return c.chat_id ? m.chatId === c.chat_id : !!c.chat && m.chat === c.chat;
}
export const shoppingKey = (s: string) => s.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
