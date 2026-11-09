// One address for Google: www.gremiercoffee.co.il (and any other host alias) redirects permanently to
// gremiercoffee.co.il, keeping the path and query.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === 'www.gremiercoffee.co.il') {
    url.hostname = 'gremiercoffee.co.il';
    return Response.redirect(url.toString(), 301);
  }
  // An old address from before this site that Google still lists; it would otherwise show the home page under a dead link.
  if (url.pathname === '/blank-4') return Response.redirect(new URL('/', url), 301);
  // Google Search Console's verification file, served exactly at its .html address (Pages would otherwise
  // redirect it to the address without .html, which verification doesn't follow).
  if (url.pathname === '/googlef176035d9a2fccb1.html') {
    return new Response('google-site-verification: googlef176035d9a2fccb1.html', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return context.next();
}
