export default async function handler(req, res) {
  const { url, token } = req.query;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  try {
    const key = "6b9d0b80272b4bddecefab2e0b93f8e2";
    const decodedUrl = decodeURIComponent(url);
    const sep = decodedUrl.includes('?') ? '&' : '?';
    const finalUrl = `${decodedUrl}${sep}key=${key}&token=${token}`;

    console.log("Fetching:", finalUrl);

    const response = await fetch(finalUrl, {
      redirect: 'follow',
      headers: {
        'Authorization': `OAuth oauth_consumer_key="${key}", oauth_token="${token}"`,
        'Accept': '*/*'
      }
    });

    console.log("Response status:", response.status);

    if (!response.ok) throw new Error(`Trello returned ${response.status}`);

    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}