const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { exec } = require('child_process'); 

const app = express();
const PORT = 5000;

// middleware
app.use(cors());
app.use(bodyParser.json());

// endpoint to handle download requests
app.post('/download', (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).send({ error: 'YouTube URL is required.' });
  }

  // execute yt-dl command to download the youtube video
  exec(`yt-dlp "${url}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${stderr}`);
      return res.status(500).send({ error: 'failure' });
    }

    console.log(`Output: ${stdout}`);
    res.send({ message: 'success', output: stdout });
  });
});

// start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
