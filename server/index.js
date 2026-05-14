require('dotenv').config();
const express = require('express');
const cors = require('cors');

const attachmentsRouter = require('./routes/attachments');
const downloadRouter = require('./routes/download');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

app.use('/api/attachments', attachmentsRouter);
app.use('/api/download', downloadRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));