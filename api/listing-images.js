const PHOTO_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;

function storagePath(value, config) {
  if (typeof value !== "string" || !value) return null;
  let candidate = value;
  if (/^https:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.origin !== config.url) return null;
      const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/lockd-listings\/(.+)$/);
      if (!match) return null;
      candidate = match[1].split("/").map((part) => decodeURIComponent(part)).join("/");
    } catch { return null; }
  }
  return PHOTO_PATH.test(candidate) ? candidate : null;
}

function signedUrl(config, value) {
  if (typeof value !== "string" || !value) return null;
  if (/^https:\/\//i.test(value)) {
    try { return new URL(value).origin === config.url ? value : null; }
    catch { return null; }
  }
  if (value.startsWith("/storage/v1/")) return `${config.url}${value}`;
  if (value.startsWith("/")) return `${config.url}/storage/v1${value}`;
  return `${config.url}/storage/v1/${value.replace(/^\/+/, "")}`;
}

async function signOne(config, value, token = null) {
  const path = storagePath(value, config);
  if (!path) return null;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const headers = {
    ...config.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const response = await fetch(`${config.url}/storage/v1/object/sign/lockd-listings/${encodedPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return signedUrl(config, data.signedURL || data.signedUrl);
}

async function signImages(config, values, { token = null, limit = Infinity } = {}) {
  if (!Array.isArray(values)) return [];
  const selected = values.slice(0, limit);
  const result = new Array(selected.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, selected.length) }, async () => {
    while (cursor < selected.length) {
      const index = cursor++;
      result[index] = await signOne(config, selected[index], token);
    }
  });
  await Promise.all(workers);
  return result;
}

module.exports = { storagePath, signedUrl, signOne, signImages };
