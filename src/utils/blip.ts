const BLIP_BASE_URL = 'https://blippay.me';

export interface BlipDeepLinkOptions {
  url: string;
  name?: string;
  quantity?: string;
  quantityId?: string;
}

export function buildBlipBrowserLink(url: string): string {
  const target = new URL(url);
  const browserUrl = new URL('/browser', BLIP_BASE_URL);
  browserUrl.searchParams.set('url', target.toString());
  return browserUrl.toString();
}

export function buildBlipShareLink(options: BlipDeepLinkOptions): string {
  const target = new URL(options.url);
  const { name, quantity, quantityId } = options;
  if (name) target.searchParams.set('name', name);
  if (quantity) target.searchParams.set('q', quantity);
  if (quantityId) target.searchParams.set('qi', quantityId);

  const shareUrl = new URL('/contact', BLIP_BASE_URL);
  shareUrl.searchParams.set('url', target.toString());
  return shareUrl.toString();
}
