const express = require('express');
const axios = require('axios');
const archiver = require('archiver');
const router = express.Router();

router.post('/zip', async (req, res) => {
  const { attachments, folderMode } = req.body;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="trello-attachments.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);

  for (const att of attachments) {
    try {
      const response = await axios.get(att.url, { responseType: 'stream' });
      const folder = folderMode === 'card' ? att.cardName
                   : folderMode === 'list' ? att.listName
                   : '';
      const filePath = folder ? `${folder}/${att.name}` : att.name;
      archive.append(response.data, { name: filePath });
    } catch (e) {
      console.error('Failed to fetch:', att.url);
    }
  }

  archive.finalize();
});

module.exports = router;