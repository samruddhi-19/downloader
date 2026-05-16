export default async function handler(req, res) {
  let { url, token } = req.query;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  try {
    const decodedUrl = decodeURIComponent(url);
    // Append token if provided
    const finalUrl = token 
      ? `${decodedUrl}${decodedUrl.includes('?') ? '&' : '?'}token=${token}`
      : decodedUrl;

    const response = await fetch(finalUrl);
    if (!response.ok) throw new Error(`Status ${response.status}`);
    
    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch", details: err.message });
  }
}