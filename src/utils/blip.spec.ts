import {
  buildBlipBrowserLink,
  buildBlipContactLink,
  buildBlipInvoiceLink,
  buildBlipReviewLink,
  buildBlipSuccessLink,
  buildManagedQuaiInvoicePageLink,
} from './blip';

describe('blip link builders', () => {
  const base = 'https://blippay.me';

  it('builds a browser link wrapping the target URL', () => {
    const link = buildBlipBrowserLink('https://quaiswap.io');
    expect(link).toBe(
      `${base}/browser?url=${encodeURIComponent('https://quaiswap.io')}`,
    );
  });

  it('builds a contact share link with name, q and qi', () => {
    const link = buildBlipContactLink({
      name: 'Basil',
      address: '0x1234',
      quantityId: 'qi-1',
    });
    expect(link).toBe(`${base}/contact?name=Basil&q=0x1234&qi=qi-1`);
  });

  it('builds a funding invoice link with i and q', () => {
    const link = buildBlipInvoiceLink({
      invoiceRef: 'inv_1',
      address: '0x1234',
    });
    expect(link).toBe(`${base}/fund/invoice?i=inv_1&q=0x1234`);
  });

  it('builds review and success links', () => {
    expect(buildBlipReviewLink({ address: '0x1234', amountCents: 2500 })).toBe(
      `${base}/fund/review?address=0x1234&amount_cents=2500`,
    );
    expect(
      buildBlipSuccessLink({
        sessionId: 'cs_1',
        address: '0x1234',
        amountCents: 2500,
      }),
    ).toBe(
      `${base}/fund/success?session_id=cs_1&address=0x1234&amount_cents=2500`,
    );
  });

  it('builds the managed QUAI invoice page link', () => {
    const link = buildManagedQuaiInvoicePageLink({
      invoiceRef: 'inv_1',
      address: '0x1234',
      amountCents: 2500,
      title: 'Services',
      currency: 'USDT',
    });
    expect(link).toBe(
      `${base}/api/ramp/managed-quai/invoice-page?i=inv_1&q=0x1234&c=2500&t=Services&p=USDT`,
    );
  });
});
