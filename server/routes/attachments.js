const express = require('express');
const axios = require('axios');
const router = express.Router();

const TRELLO_API = 'https://api.trello.com/1';

router.get('/', async (req, res) => {
  const { boardId, token, key } = req.query;

  try {
    const cardsRes = await axios.get(
      `${TRELLO_API}/boards/${boardId}/cards?attachments=true&key=${key}&token=${token}`
    );

    const cards = cardsRes.data;
    const allAttachments = [];

    for (const card of cards) {
      if (card.attachments?.length > 0) {
        for (const att of card.attachments) {
          allAttachments.push({
            id: att.id,
            name: att.name,
            url: att.url,
            bytes: att.bytes,
            mimeType: att.mimeType,
            cardName: card.name,
            cardId: card.id,
            listId: card.idList,
          });
        }
      }
    }

    const listsRes = await axios.get(
      `${TRELLO_API}/boards/${boardId}/lists?key=${key}&token=${token}`
    );

    res.json({ attachments: allAttachments, lists: listsRes.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;