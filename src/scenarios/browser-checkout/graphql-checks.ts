import type { ValidationStep } from '../../models/types.js';

export const DEMO_ORDER_CODE = 'ORD-DEMO-1';
export const DEMO_CUSTOMER_EMAIL = 'demo@example.com';

/**
 * Independent backend evidence run *after* the Playwright journey.
 *
 *   GraphQL → query product → query customer/order → verify expected state
 *
 * This is deliberately separate from browser screenshots: UI looking correct
 * is not enough without API confirmation.
 */
export function buildPostBrowserGraphqlSteps(input: {
  readonly baseUrl: string;
  readonly productName?: string;
  readonly orderCode?: string;
  readonly customerEmail?: string;
  readonly timeoutMs?: number;
}): readonly ValidationStep[] {
  const productName = input.productName ?? 'Soft Pink Almond';
  const orderCode = input.orderCode ?? DEMO_ORDER_CODE;
  const customerEmail = input.customerEmail ?? DEMO_CUSTOMER_EMAIL;
  const shopApi = `${input.baseUrl.replace(/\/$/, '')}/shop-api`;
  const timeoutMs = input.timeoutMs ?? 10_000;

  return [
    {
      id: 'graphql-query-product',
      type: 'graphql_request',
      url: shopApi,
      query: `query ProductBySlug {
        product(slug: "soft-pink-almond") {
          id
          name
          slug
        }
      }`,
      variables: {},
      headers: {},
      expectNoErrors: true,
      expectDataPath: 'product.name',
      expectDataEquals: productName,
      timeoutMs,
    },
    {
      id: 'graphql-query-order',
      type: 'graphql_request',
      url: shopApi,
      query: `query OrderByCode {
        order(code: "${orderCode}") {
          id
          code
          state
          lines {
            quantity
            productVariant { name sku }
          }
        }
      }`,
      variables: {},
      headers: {},
      expectNoErrors: true,
      expectDataPath: 'order.code',
      expectDataEquals: orderCode,
      timeoutMs,
    },
    {
      id: 'graphql-query-customer-orders',
      type: 'graphql_request',
      url: shopApi,
      query: `query CustomerOrders {
        activeCustomer {
          emailAddress
          orders {
            items { code state }
          }
        }
      }`,
      variables: {},
      headers: {},
      expectNoErrors: true,
      expectDataPath: 'activeCustomer.emailAddress',
      expectDataEquals: customerEmail,
      timeoutMs,
    },
    {
      id: 'api-order-state',
      type: 'http_response',
      url: `${input.baseUrl.replace(/\/$/, '')}/api/orders/${orderCode}`,
      method: 'GET',
      headers: {},
      expectStatus: 200,
      expectBodyContains: productName,
      timeoutMs,
    },
  ];
}
