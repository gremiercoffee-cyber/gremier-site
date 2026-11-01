// One address for Google: www.gremiercoffee.co.il (and any other host alias) redirects permanently to
// gremiercoffee.co.il, keeping the path and query.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === 'www.gremiercoffee.co.il') {
    url.hostname = 'gremiercoffee.co.il';
    return Response.redirect(url.toString(), 301);
  }
  return context.next();
}
