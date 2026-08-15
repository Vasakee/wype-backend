const BLIP_BASE_URL = 'https://blippay.me';

export interface BlipContactShareOptions {
  name?: string;
  address: string;
  quantityId?: string;
}

export interface BlipInvoiceLinkOptions {
  invoiceRef: string;
  address: string;
}

export interface BlipReviewLinkOptions {
  address: string;
  amountCents: number;
}

export interface BlipSuccessLinkOptions {
  sessionId: string;
  address: string;
  amountCents: number;
}

export interface BlipInvoicePageLinkOptions extends BlipInvoiceLinkOptions {
  amountCents: number;
  title?: string;
  currency?: string;
}

/** Opens an arbitrary dApp URL inside the Blip Pay in-app browser. */
export function buildBlipBrowserLink(
  url: string,
  baseUrl = BLIP_BASE_URL,
): string {
  const browser = new URL('/browser', baseUrl);
  browser.searchParams.set('url', url);
  return browser.toString();
}

/** Shares a wallet address / payment request to a Blip Pay contact. */
export function buildBlipContactLink(
  options: BlipContactShareOptions,
  baseUrl = BLIP_BASE_URL,
): string {
  const contact = new URL('/contact', baseUrl);
  if (options.name) contact.searchParams.set('name', options.name);
  contact.searchParams.set('q', options.address);
  if (options.quantityId) contact.searchParams.set('qi', options.quantityId);
  return contact.toString();
}

/** Blip Pay funding invoice page for a wallet. */
export function buildBlipInvoiceLink(
  options: BlipInvoiceLinkOptions,
  baseUrl = BLIP_BASE_URL,
): string {
  const invoice = new URL('/fund/invoice', baseUrl);
  invoice.searchParams.set('i', options.invoiceRef);
  invoice.searchParams.set('q', options.address);
  return invoice.toString();
}

/** Blip Pay funding review page (shown before payment). */
export function buildBlipReviewLink(
  options: BlipReviewLinkOptions,
  baseUrl = BLIP_BASE_URL,
): string {
  const review = new URL('/fund/review', baseUrl);
  review.searchParams.set('address', options.address);
  review.searchParams.set('amount_cents', String(options.amountCents));
  return review.toString();
}

/** Blip Pay funding success page. */
export function buildBlipSuccessLink(
  options: BlipSuccessLinkOptions,
  baseUrl = BLIP_BASE_URL,
): string {
  const success = new URL('/fund/success', baseUrl);
  success.searchParams.set('session_id', options.sessionId);
  success.searchParams.set('address', options.address);
  success.searchParams.set('amount_cents', String(options.amountCents));
  return success.toString();
}

/** Managed QUAI checkout invoice page served by the Blip API. */
export function buildManagedQuaiInvoicePageLink(
  options: BlipInvoicePageLinkOptions,
  baseUrl = BLIP_BASE_URL,
): string {
  const page = new URL('/api/ramp/managed-quai/invoice-page', baseUrl);
  page.searchParams.set('i', options.invoiceRef);
  page.searchParams.set('q', options.address);
  page.searchParams.set('c', String(options.amountCents));
  if (options.title) page.searchParams.set('t', options.title);
  if (options.currency) page.searchParams.set('p', options.currency);
  return page.toString();
}
