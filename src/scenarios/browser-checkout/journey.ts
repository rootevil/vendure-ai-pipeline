import type { ValidationStep } from '../../models/types.js';

export const CHECKOUT_SCREENSHOTS = [
  '01-home.png',
  '02-product.png',
  '03-cart.png',
  '04-checkout.png',
] as const;

/**
 * Client-demo Playwright journey:
 * Open storefront → Find product → Open product → Add to cart → Checkout → Verify
 */
export function buildCheckoutJourneyActions(productName = 'Soft Pink Almond'): Extract<
  ValidationStep,
  { type: 'browser_journey' }
>['actions'] {
  return [
    {
      type: 'goto',
      path: '/',
      screenshot: '01-home.png',
      expectTitleContains: 'Home',
      expectSelector: '[data-testid="home-heading"]',
      expectTextContains: 'Welcome',
    },
    {
      type: 'click',
      selector: '[data-testid="product-link"]',
      screenshot: '02-product.png',
      expectSelector: '[data-testid="product-heading"]',
      expectTextContains: productName,
    },
    {
      type: 'click',
      selector: '[data-testid="add-to-cart"]',
      screenshot: '03-cart.png',
      expectSelector: '[data-testid="cart-heading"]',
      expectTextContains: 'cart',
    },
    {
      type: 'click',
      selector: '[data-testid="checkout-link"]',
      screenshot: '04-checkout.png',
      expectSelector: '[data-testid="checkout-heading"]',
      expectTextContains: 'Checkout',
    },
    {
      type: 'click',
      selector: '[data-testid="place-order"]',
      expectSelector: '[data-testid="order-confirmation"]',
      expectTextContains: 'Order confirmed',
    },
    {
      type: 'assert',
      expectSelector: '[data-testid="order-result"]',
      expectTextContains: productName,
    },
  ];
}

export function buildCheckoutJourneyStep(input: {
  readonly startUrl: string;
  readonly id?: string;
  readonly productName?: string;
  readonly timeoutMs?: number;
}): Extract<ValidationStep, { type: 'browser_journey' }> {
  return {
    id: input.id ?? 'checkout-journey',
    type: 'browser_journey',
    startUrl: input.startUrl,
    timeoutMs: input.timeoutMs ?? 60_000,
    resultsFileName: 'playwright-results.json',
    actions: buildCheckoutJourneyActions(input.productName),
  };
}
