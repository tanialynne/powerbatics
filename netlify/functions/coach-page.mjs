// Netlify Function — CORS-safe proxy for coach custom-program pages.
// Usage: GET /api/coach-page?url=https%3A%2F%2Fcustom.pacificrimathletics.com%2F...
//
// Only allowlisted hosts are proxied (not an open proxy). Add hosts below
// if other studios come on board.

const ALLOWED_HOSTS = new Set([
  "custom.pacificrimathletics.com",
]);

export default async (req) => {
  const u = new URL(req.url);
  const target = u.searchParams.get("url");
  if (!target) return textRes("missing ?url", 400);

  let t;
  try {
    t = new URL(target);
  } catch {
    return textRes("bad url", 400);
  }
  if (t.protocol !== "https:") return textRes("https only", 400);
  if (!ALLOWED_HOSTS.has(t.hostname)) {
    return textRes(`host not allowlisted: ${t.hostname}`, 403);
  }

  try {
    const upstream = await fetch(t.toString(), {
      headers: {
        "User-Agent": "Powerbatics/1.0 (+https://github.com/tanialynne/powerbatics)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "access-control-allow-origin": "*",
        // Short edge cache so rapid refreshes don't hammer the source.
        "cache-control": "public, max-age=60",
      },
    });
  } catch (e) {
    return textRes(`fetch failed: ${e.message}`, 502);
  }
};

function textRes(msg, status) {
  return new Response(msg, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

export const config = { path: "/api/coach-page" };
