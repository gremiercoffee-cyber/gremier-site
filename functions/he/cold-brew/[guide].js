import { guideRoute, GUIDES } from '../../_guides.js';

export async function onRequestGet(context) {
  const key = String(context.params.guide || '');
  if (!key || !Object.prototype.hasOwnProperty.call(GUIDES, key)) return Response.redirect(new URL('/he/cold-brew', context.request.url), 301);
  return guideRoute(key, 'he')();
}
