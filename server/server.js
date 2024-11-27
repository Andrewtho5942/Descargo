const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs')
const { google } = require('googleapis');
const path = require('path');

const key = require('./keys/yt-dl-443015-d39da117fe4a.json');

const auth = new google.auth.GoogleAuth({
  credentials: key,
  scopes: ['https://www.googleapis.com/auth/drive.file'],
});
const drive = google.drive({ version: 'v3', auth });

const app = express();
const PORT = 5000;

// middleware
app.use(cors());
app.use(bodyParser.json());


// function to get the most recently modified file in a folder
function getMostRecentFile(dir) {
  const files = fs.readdirSync(dir); // Read all files in the directory
  let latestFile = null;
  let latestTime = 0;

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isFile() && stat.mtimeMs > latestTime) {
      latestFile = filePath;
      latestTime = stat.mtimeMs;
    }
  });

  return latestFile;
}

const processVideoTitle = (title) => {
  return title.replace(/(\[.*?\]|\(.*?\))/g, '').trim();
};

// function to uppload a file to google drive
async function uploadFile(filePath, fileName) {
  const fileMetadata = {
    name: fileName, // Name of the file in Drive
    parents: ['17pMCBUQxJfEYgVvNwKQUcS8n4oRGIE9q'],
  };

  const media = {
    mimeType: 'application/octet-stream',
    body: fs.createReadStream(filePath),
  };

  try {
    const response = drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id',
    });
    console.log('File uploaded successfully!');
  } catch (error) {
    console.error('Error uploading file:', error);
  }
}


// endpoint to handle download requests
app.post('/download', (req, res) => {
  const { url, format, gdrive } = req.body;

  if (!url) {
    return res.status(400).send({ error: 'YouTube URL is required.' });
  }

  // execute yt-dl command to download the youtube video
  exec(`yt-dlp "${url}" -f "${format}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${stderr}`);
      return res.status(500).send({ error: 'failure' });
    }

    if (gdrive) {
      let latestFilePath = getMostRecentFile("C:\\Users\\andre\\Downloads\\yt-downloads");
      // process the video title without the extension and append the extension to it after...
      let fileName = processVideoTitle(path.basename(latestFilePath, path.extname(latestFilePath))) + path.extname(latestFilePath);
      console.log('uploading ' + fileName)
      uploadFile(latestFilePath, fileName)
    }

    console.log(`Output: ${stdout}`);
    res.send({ message: 'success', output: stdout });
  });
});

// start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
