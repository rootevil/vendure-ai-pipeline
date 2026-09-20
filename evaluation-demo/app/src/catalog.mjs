// Public demo migration adapter.

function toSlug(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toPriceCents(price) {
  const cents = Math.round(Number.parseFloat(String(price)) * 100);
  if (!Number.isFinite(cents)) {
    throw new Error(`Invalid price value: ${price}`);
  }
  return cents;
}

export function migrateCatalog(legacyCatalog) {
  const items = Array.isArray(legacyCatalog?.items) ? legacyCatalog.items : [];

  return items
    .filter((item) => item?.active === true)
    .map((item) => ({
      sku: item.legacySku,
      name: item.name,
      slug: toSlug(item.name),
      price_cents: toPriceCents(item.price),
      image_count: Array.isArray(item.imagePaths) ? item.imagePaths.length : 0,
    }))
    .sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
}
