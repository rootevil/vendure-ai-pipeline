import { createServer, type Server } from 'node:http';

export interface DemoStorefrontHandle {
  readonly baseUrl: string;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Visually obvious mini storefront for Playwright browser-validation demos.
 *
 * Routes:
 *   /              home / product list
 *   /product/:slug product detail + Add to cart
 *   /cart          cart
 *   /checkout      checkout → confirmation
 */
export async function startBrowserCheckoutDemoStorefront(input?: {
  readonly host?: string;
  readonly productName?: string;
}): Promise<DemoStorefrontHandle> {
  const host = input?.host ?? '127.0.0.1';
  const productName = input?.productName ?? 'Soft Pink Almond';
  const productSlug = 'soft-pink-almond';

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    const path = url.pathname;

    if (path === '/health') {
      writeJson(res, 200, { ok: true, service: 'browser-checkout-demo' });
      return;
    }

    if (path === '/') {
      writeHtml(res, homePage(productName, productSlug));
      return;
    }

    if (path === `/product/${productSlug}`) {
      writeHtml(res, productPage(productName, productSlug));
      return;
    }

    if (path === '/cart') {
      writeHtml(res, cartPage(productName));
      return;
    }

    if (path === '/checkout') {
      writeHtml(res, checkoutPage(productName));
      return;
    }

    writeJson(res, 404, { error: 'not_found' });
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

function checkoutPage(productName: string): string {
  return pageShell(
    'Demo Store — Checkout',
    `
  <header class="bar"><a href="/">Yvivi Demo Store</a></header>
  <main>
    <h1 data-testid="checkout-heading">Checkout</h1>
    <p data-testid="checkout-item">Order: ${escapeHtml(productName)}</p>
    <form id="checkout-form" data-testid="checkout-form" onsubmit="event.preventDefault(); document.getElementById('confirmation').hidden=false; this.hidden=true;">
      <label>Email <input data-testid="email" name="email" type="email" value="demo@example.com" /></label>
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

function writeHtml(res: import('node:http').ServerResponse, html: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function writeJson(
  res: import('node:http').ServerResponse,
  status: number,
  payload: unknown,
): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(payload)}\n`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
