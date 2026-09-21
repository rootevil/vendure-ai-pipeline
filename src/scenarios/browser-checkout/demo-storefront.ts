import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface DemoStorefrontHandle {
  readonly baseUrl: string;
  readonly port: number;
  close(): Promise<void>;
}

export interface DemoCatalogProduct {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly priceWithTax: number;
}

export interface DemoOrder {
  readonly id: string;
  readonly code: string;
  readonly state: string;
  readonly customerEmail: string;
  readonly lines: ReadonlyArray<{
    readonly productVariant: { readonly name: string; readonly sku: string };
    readonly quantity: number;
  }>;
}

/**
 * Visually obvious mini storefront + Vendure-shaped Shop API for dual evidence demos.
 *
 * HTML routes (browser evidence):
 *   /  /product/:slug  /cart  /checkout
 *
 * Backend routes (GraphQL/API evidence):
 *   POST /shop-api   — product + customer/order queries
 *   GET  /api/products
 *   GET  /api/orders/:code
 */
export async function startBrowserCheckoutDemoStorefront(input?: {
  readonly host?: string;
  readonly productName?: string;
  readonly orderCode?: string;
  readonly customerEmail?: string;
}): Promise<DemoStorefrontHandle> {
  const host = input?.host ?? '127.0.0.1';
  const productName = input?.productName ?? 'Soft Pink Almond';
  const productSlug = 'soft-pink-almond';
  const orderCode = input?.orderCode ?? 'ORD-DEMO-1';
  const customerEmail = input?.customerEmail ?? 'demo@example.com';

  const product: DemoCatalogProduct = {
    id: '1',
    name: productName,
    slug: productSlug,
    priceWithTax: 2400,
  };

  // Backend state exists independently of the HTML journey — GraphQL verifies it after Playwright.
  const orders: DemoOrder[] = [
    {
      id: '42',
      code: orderCode,
      state: 'PaymentSettled',
      customerEmail,
      lines: [
        {
          productVariant: { name: productName, sku: productSlug },
          quantity: 1,
        },
      ],
    },
  ];

  const server: Server = createServer((req, res) => {
    void handleRequest(req, res, { product, orders, productName, productSlug, customerEmail });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, host, () => resolve());
    server.on('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to bind browser checkout demo storefront');
  }

  return {
    baseUrl: `http://${host}:${address.port}`,
    port: address.port,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  state: {
    readonly product: DemoCatalogProduct;
    readonly orders: DemoOrder[];
    readonly productName: string;
    readonly productSlug: string;
    readonly customerEmail: string;
  },
): Promise<void> {
  try {
    const host = req.headers.host ?? '127.0.0.1';
    const url = new URL(req.url ?? '/', `http://${host}`);
    const path = url.pathname;

    if (path === '/health') {
      writeJson(res, 200, { ok: true, service: 'browser-checkout-demo' });
      return;
    }

    if (path === '/shop-api' && req.method === 'POST') {
      const body = await readBody(req);
      writeJson(res, 200, handleShopApi(body, state));
      return;
    }

    if (path === '/api/products' && req.method === 'GET') {
      writeJson(res, 200, { items: [state.product], totalItems: 1 });
      return;
    }

    if (path.startsWith('/api/orders/') && req.method === 'GET') {
      const code = decodeURIComponent(path.slice('/api/orders/'.length));
      const order = state.orders.find((item) => item.code === code);
      if (!order) {
        writeJson(res, 404, { error: 'order_not_found' });
        return;
      }
      writeJson(res, 200, order);
      return;
    }

    if (path === '/') {
      writeHtml(res, homePage(state.productName, state.productSlug));
      return;
    }

    if (path === `/product/${state.productSlug}`) {
      writeHtml(res, productPage(state.productName, state.productSlug));
      return;
    }

    if (path === '/cart') {
      writeHtml(res, cartPage(state.productName));
      return;
    }

    if (path === '/checkout') {
      writeHtml(res, checkoutPage(state.productName, state.customerEmail));
      return;
    }

    writeJson(res, 404, { error: 'not_found' });
  } catch (error) {
    writeJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function handleShopApi(
  body: string,
  state: {
    readonly product: DemoCatalogProduct;
    readonly orders: DemoOrder[];
    readonly customerEmail: string;
  },
): unknown {
  let query = '';
  try {
    query = String((JSON.parse(body) as { query?: string }).query ?? '');
  } catch {
    return { errors: [{ message: 'Invalid JSON body' }] };
  }

  const normalized = query.replace(/\s+/g, ' ');

  if (/product\s*\(/i.test(normalized) || /products\s*\{/i.test(normalized)) {
    if (/product\s*\(/i.test(normalized)) {
      return {
        data: {
          product: {
            id: state.product.id,
            name: state.product.name,
            slug: state.product.slug,
            variants: [{ priceWithTax: state.product.priceWithTax }],
          },
        },
      };
    }
    return {
      data: {
        products: {
          totalItems: 1,
          items: [
            {
              id: state.product.id,
              name: state.product.name,
              slug: state.product.slug,
            },
          ],
        },
      },
    };
  }

  if (/activeOrder/i.test(normalized) || /order\s*\(/i.test(normalized)) {
    const codeMatch = normalized.match(/code\s*:\s*"([^"]+)"/i);
    const requestedCode = codeMatch?.[1];
    const order =
      requestedCode !== undefined
        ? state.orders.find((item) => item.code === requestedCode)
        : state.orders[0];
    if (!order) {
      return { data: { activeOrder: null, order: null } };
    }
    const payload = {
      id: order.id,
      code: order.code,
      state: order.state,
      lines: order.lines,
    };
    if (/activeOrder/i.test(normalized)) {
      return { data: { activeOrder: payload } };
    }
    return { data: { order: payload } };
  }

  if (/customer/i.test(normalized)) {
    return {
      data: {
        activeCustomer: {
          id: 'cust-1',
          emailAddress: state.customerEmail,
          orders: {
            items: state.orders.map((order) => ({
              id: order.id,
              code: order.code,
              state: order.state,
            })),
          },
        },
      },
    };
  }

  return { errors: [{ message: 'Unsupported GraphQL query for demo shop-api' }] };
}

function homePage(productName: string, slug: string): string {
  return pageShell(
    'Demo Store — Home',
    `
  <header class="bar"><strong>Yvivi Demo Store</strong></header>
  <main>
    <h1 data-testid="home-heading">Welcome to the storefront</h1>
    <p>Find a product and complete checkout.</p>
    <ul class="products" data-testid="product-list">
      <li>
        <a data-testid="product-link" href="/product/${slug}">${escapeHtml(productName)}</a>
      </li>
    </ul>
  </main>`,
  );
}

function productPage(productName: string, slug: string): string {
  return pageShell(
    `Demo Store — ${productName}`,
    `
  <header class="bar"><a href="/">Yvivi Demo Store</a></header>
  <main>
    <h1 data-testid="product-heading">${escapeHtml(productName)}</h1>
    <p data-testid="product-description">Handcrafted nail set — add to cart to continue.</p>
    <p><strong data-testid="product-price">€24.00</strong></p>
    <form action="/cart" method="get">
      <button type="submit" data-testid="add-to-cart">Add to cart</button>
    </form>
    <p class="muted">SKU: ${escapeHtml(slug)}</p>
  </main>`,
  );
}

function cartPage(productName: string): string {
  return pageShell(
    'Demo Store — Cart',
    `
  <header class="bar"><a href="/">Yvivi Demo Store</a></header>
  <main>
    <h1 data-testid="cart-heading">Your cart</h1>
    <table data-testid="cart-table">
      <tr><td>${escapeHtml(productName)}</td><td>1 × €24.00</td></tr>
    </table>
    <p data-testid="cart-total">Total: €24.00</p>
    <a data-testid="checkout-link" class="btn" href="/checkout">Checkout</a>
  </main>`,
  );
}

function checkoutPage(productName: string, customerEmail: string): string {
  return pageShell(
    'Demo Store — Checkout',
    `
  <header class="bar"><a href="/">Yvivi Demo Store</a></header>
  <main>
    <h1 data-testid="checkout-heading">Checkout</h1>
    <p data-testid="checkout-item">Order: ${escapeHtml(productName)}</p>
    <form id="checkout-form" data-testid="checkout-form" onsubmit="event.preventDefault(); document.getElementById('confirmation').hidden=false; this.hidden=true;">
      <label>Email <input data-testid="email" name="email" type="email" value="${escapeHtml(customerEmail)}" /></label>
      <button type="submit" data-testid="place-order">Place order</button>
    </form>
    <div id="confirmation" data-testid="order-confirmation" hidden>
      <h2>Order confirmed</h2>
      <p data-testid="order-result">Thank you — your order for ${escapeHtml(productName)} is confirmed.</p>
    </div>
  </main>`,
  );
}

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: Georgia, "Times New Roman", serif; }
    body { margin: 0; background: linear-gradient(160deg, #f7f1e8, #e8f0f4 55%, #f0e6f2); min-height: 100vh; color: #1a1a1a; }
    .bar { background: #1f2a24; color: #f7f1e8; padding: 1rem 1.5rem; }
    .bar a { color: #f7f1e8; }
    main { max-width: 40rem; margin: 2rem auto; padding: 1.5rem; background: rgba(255,255,255,0.88); border: 1px solid #d5c8b8; }
    h1 { margin-top: 0; font-size: 2rem; }
    .products { list-style: none; padding: 0; }
    .products a { font-size: 1.25rem; color: #0b5fff; }
    button, .btn {
      display: inline-block; margin-top: 1rem; padding: 0.75rem 1.25rem;
      background: #c45c26; color: #fff; border: 0; text-decoration: none; font: inherit; cursor: pointer;
    }
    .muted { color: #666; font-size: 0.9rem; }
    label { display: block; margin: 0.75rem 0; }
    input { padding: 0.4rem; width: 100%; max-width: 20rem; }
    #confirmation { margin-top: 1.5rem; padding: 1rem; background: #e7f6ec; border: 1px solid #8bc49a; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function writeHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(payload)}\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
