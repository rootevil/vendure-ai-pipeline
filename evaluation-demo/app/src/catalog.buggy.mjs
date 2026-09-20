/**
 * Controlled buggy adapter for Phase 9 recoverable failure demo.
 * Intentionally wrong: keeps inactive records and leaks internalNote.
 * Acceptance tests and GraphQL totalItems===2 must fail until repaired.
 */
export function migrateCatalog(legacyCatalog) {
  const items = Array.isArray(legacyCatalog?.items) ? legacyCatalog.items : [];
  return items.map((item) => ({
    sku: item.legacySku,
    name: item.name,
    slug: String(item.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
    price_cents: Math.round(Number(item.price) * 100),
    image_count: Array.isArray(item.imagePaths) ? item.imagePaths.length : 0,
    internalNote: item.internalNote,
  }));
}
