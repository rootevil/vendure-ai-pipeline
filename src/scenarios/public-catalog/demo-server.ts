import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DemoServerHandle {
  readonly baseUrl: string;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Lightweight stand-in for a Vendure shop surface in the isolated evaluation env.
 * Serves health, REST, GraphQL, and an HTML page backed by migrateCatalog().
 */
export async function startPublicCatalogDemoServer(input: {
  readonly appDir: string;
  readonly host?: string;
}): Promise<DemoServerHandle> {
  const host = input.host ?? '127.0.0.1';
  const legacyPath = join(input.appDir, 'fixtures', 'legacy-catalog.json');
  const catalogModulePath = join(input.appDir, 'src', 'catalog.mjs');

  const loadCatalog = async (): Promise<unknown[]> => {
    const legacy = JSON.parse(readFileSync(legacyPath, 'utf8')) as unknown;
    const bust = `${pathToFileURL(catalogModulePath).href}?t=${Date.now()}`;
    const mod = (await import(bust)) as { migrateCatalog?: (input: unknown) => unknown[] };
    if (typeof mod.migrateCatalog !== 'function') {
      return [];
    }
    const result = mod.migrateCatalog(legacy);
    return Array.isArray(result) ? result : [];
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', `http://${host}`);
        if (url.pathname === '/health') {
          writeJson(res, 200, { ok: true, service: 'vendure-public-catalog-demo' });
          return;
        }

        if (url.pathname === '/api/products' && req.method === 'GET') {
          const products = await loadCatalog();
          writeJson(res, 200, { items: products, totalItems: products.length });
          return;
        }

        if (url.pathname === '/graphql' && req.method === 'POST') {
          const body = await readBody(req);
          let query = '';
          try {
            query = String((JSON.parse(body) as { query?: string }).query ?? '');
          } catch {
            writeJson(res, 400, { errors: [{ message: 'Invalid JSON body' }] });
            return;
          }
          if (!query.includes('products')) {
            writeJson(res, 200, { errors: [{ message: 'Unsupported GraphQL query' }] });
            return;
          }
          const products = await loadCatalog();
          writeJson(res, 200, {
            data: {
              products: {
                totalItems: products.length,
                items: products,
              },
            },
          });
          return;
        }

        if (url.pathname === '/' && req.method === 'GET') {
          const products = await loadCatalog();
          const names = products
            .map((item) => {
              const record = item as { name?: string };
              return record.name ?? 'item';
            })
            .join(', ');
          const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Public Catalog Demo</title></head>
<body>
  <h1>Products</h1>
  <p id="product-list">${escapeHtml(names || 'No products')}</p>
</body>
</html>`;
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }

        writeJson(res, 404, { error: 'not_found' });
      } catch (error) {
        writeJson(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, host, () => resolve());
    server.on('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to bind public catalog demo server');
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

function writeJson(
  res: import('node:http').ServerResponse,
  status: number,
  payload: unknown,
): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(payload)}\n`);
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
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
