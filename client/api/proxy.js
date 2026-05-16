export default async function handler(req, res) {
  const { url, token } = req.query;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  try {
    const decodedUrl = decodeURIComponent(url);
    const key = process.env.VITE_TRELLO_API_KEY;

    // Append both key and token
    const sep = decodedUrl.includes('?') ? '&' : '?';
    const finalUrl = `${decodedUrl}${sep}key=${key}&token=${token}`;

    const response = await fetch(finalUrl);
    if (!response.ok) throw new Error(`Trello returned ${response.status}`);

    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch", details: err.message });
  }
}