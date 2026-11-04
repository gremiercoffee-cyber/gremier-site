/** A passive dependency is never an action, even after its follow-up interval has elapsed. */
export const isWaiting=(i:{kind:string;title:string})=>i.kind==='waiting'||/^(?:wait(?:ing)?\s+(?:for|on)\b|await(?:ing)?\b|waiting\s*[:—-])/i.test(i.title.trim());
