// Hosts this proxy is willing to attach the caller's Trello token to. Without
// this check any URL could be passed in and the user's OAuth token would be
// forwarded straight to it.
const ALLOWED_HOSTS = new Set([
  "trello.com",
  "www.trello.com",
  "api.trello.com",
  "attachments.trello.com",
]);

// Types the browser can safely render inline from our own origin. Anything that
// can execute (HTML, SVG) stays off this list — serving attacker-supplied
// markup as text/html from this domain would be an XSS vector.
const INLINE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function isAllowed(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    return ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const { url, token, mime } = req.query;
  if (!url) return res.status(400).json({ error: "No URL provided" });
  if (!token) return res.status(400).json({ error: "No token provided" });
  if (!isAllowed(url))
    return res.status(400).json({ error: "URL is not a Trello attachment" });

  try {
    const key = process.env.TRELLO_API_KEY;

    // Trello's /download/ (S3-backed) route rejects key/token as query params —
    // it only accepts them via the Authorization header. Query params still work
    // for regular api.trello.com calls, but attachment downloads need this.
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "*/*",
        Authorization: `OAuth oauth_consumer_key="${key}", oauth_token="${token}"`,
      },
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      return res.status(response.status).json({
        error: `Trello returned ${response.status}`,
        detail: bodyText.slice(0, 300),
      });
    }

    const buffer = await response.arrayBuffer();

    // Trello serves attachments as application/octet-stream, which a browser
    // can only download — an <iframe> preview of a PDF just triggers a save.
    // When the caller names a renderable type, honour it so previews display.
    const upstream = response.headers.get("content-type") || "";
    const generic = !upstream || upstream.startsWith("application/octet-stream");
    const contentType =
      generic && INLINE_TYPES.has(mime)
        ? mime
        : upstream || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    // Overrides any attachment disposition inherited from S3, which would also
    // force a download instead of rendering.
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
