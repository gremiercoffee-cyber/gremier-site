import type {Env} from './env';
import {first,run} from './db';
const key=async(token:string)=>'login:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(b=>b.toString(16).padStart(2,'0')).join('');
/** Called by authenticated session handoff or owner setup; never by an unauthenticated mint route. */
export async function createDaynoteLogin(env:Env,origin:string){
 if(!env.COS_ACCESS_TOKEN)throw Error('Chief of Staff sign-in is not configured.');
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('');const expires=Date.now()+15*60000;
 await run(env,"DELETE FROM daynote_settings WHERE key LIKE 'login:%' AND CASE WHEN json_valid(value) THEN COALESCE(json_extract(value,'$.expires'),CAST(value AS INTEGER)) ELSE CAST(value AS INTEGER) END<?",Date.now());
 await run(env,'INSERT INTO daynote_settings(key,value) VALUES(?,?)',await key(token),JSON.stringify({expires,origin:new URL(origin).origin}));
 return{url:new URL('/api/daynote/sign-in?code='+token,origin).toString(),expires_at:new Date(expires).toISOString()};
}
function page(body:string,status=200,script=''){
 const nonce=crypto.randomUUID();return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Health Journal sign-in</title><style nonce="${nonce}">body{background:#0c1318;color:#f2f5f6;font:17px/1.5 system-ui;max-width:430px;margin:15vh auto;padding:28px}h1{font-size:28px}button,a{display:block;border:0;border-radius:30px;padding:18px 26px;background:#c5ef49;color:#17210b;font:700 16px system-ui;text-align:center;text-decoration:none;cursor:pointer;width:100%;box-sizing:border-box}p{color:#a7b7c0}</style>${body}${script?`<script nonce="${nonce}">${script}</script>`:''}</html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','referrer-policy':'same-origin','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`}});
}
export async function redeemDaynoteLogin(env:Env,req:Request){
 const url=new URL(req.url),code=url.searchParams.get('code')||'';
 if(!/^[a-f0-9]{64}$/.test(code))return page('<h1>Invalid sign-in link</h1><p>Ask for a fresh sign-in link.</p>',400);
 const id=await key(code);
 const valid=(value:string)=>{try{const saved=JSON.parse(value);return typeof saved==='number'?saved>Date.now():saved.expires>Date.now()&&saved.origin===url.origin;}catch{return false;}};
 if(req.method==='GET'){
  const row=await first<{value:string}>(env,'SELECT value FROM daynote_settings WHERE key=?',id);if(!row||!valid(row.value))return page('<h1>Link expired or already used</h1><p>Ask for a fresh sign-in link.</p>',410);
  // Link previews must not consume the token or receive the owner bearer.
  return page('<h1>Health Journal</h1><p>Use this one-time link to sign in on this device.</p><form method="post"><button type="submit">Sign in</button></form>');
 }
 if(req.method!=='POST'||req.headers.get('origin')!==url.origin)return page('<h1>Unable to sign in</h1>',403);
 const row=await first<{value:string}>(env,'SELECT value FROM daynote_settings WHERE key=?',id);
 if(!row||!valid(row.value)||!env.COS_ACCESS_TOKEN)return page('<h1>Link expired or already used</h1><p>Ask for a fresh sign-in link.</p>',410);
 const consumed=await first(env,'DELETE FROM daynote_settings WHERE key=? RETURNING value',id);
 if(!consumed)return page('<h1>Link expired or already used</h1>',410);
 const destination=['whoop','google'].includes(url.searchParams.get('connect')||'')?'/daynote/?tab=settings':'/daynote/';
 const token=JSON.stringify(env.COS_ACCESS_TOKEN).replace(/</g,'\\u003c');
 return page('<h1>Signing you in…</h1><p id="status">Opening your journal.</p>',200,`history.replaceState(null,'',${JSON.stringify(destination)});try{localStorage.setItem('cos.token',${token});location.replace(${JSON.stringify(destination)});}catch{document.getElementById('status').textContent='Browser storage is blocked. Allow site storage and ask for a new link.'}`);
}
