const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs-extra');
const { google } = require('googleapis');
const path = require('path');

const key = require('./keys/yt-dl-443015-d39da117fe4a.json');
const downloadsPath = "C:\\Users\\andre\\Downloads\\streaming\\yt-downloads"
const gdriveFolderID = "17pMCBUQxJfEYgVvNwKQUcS8n4oRGIE9q"


const auth = new google.auth.GoogleAuth({
  credentials: key,
  scopes: ['https://www.googleapis.com/auth/drive.file'],
});
const drive = google.drive({ version: 'v3', auth });

const app = express();
const PORT = 5001;

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
    parents: [gdriveFolderID],
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
  let command = `yt-dlp "${url}"`

  if (format === 'mp4') {
    command += ' -f \"bv+ba/b\" --merge-output-format mp4'
  } else {
    command += ' -f \"ba/b\" -f \"m4a\"'
  }

  // execute yt-dl command to download the youtube video
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${stderr}`);
      return res.status(500).send({ error: 'failure' });
    }

    if (gdrive) {
      let latestFilePath = getMostRecentFile(downloadsPath);
      // process the video title without the extension and append the extension to it after...
      let fileName = processVideoTitle(path.basename(latestFilePath, path.extname(latestFilePath))) + path.extname(latestFilePath);
      console.log('uploading ' + fileName)
      uploadFile(latestFilePath, fileName)
    }

    console.log(`Output: ${stdout}`);
    res.send({ message: 'success', output: stdout });
  });
});

//open a folder
app.post('/open', (req, res) => {
  let command = `start "" /D "${downloadsPath}" explorer "${downloadsPath}"`;
  // open the file explorer to yt-downloads folder
  //exec(command, (err, stdout, stderr) => {
  //  if (err) {
  //    console.error('Error opening folder:', err);
  //    return res.status(500).send({ message: 'Failed to open folder' });
  //  }
  //  console.log('Folder opened successfully');


    exec('"C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey.exe" "C:\\Users\\andre\\focusExplorer.ahk"', (err, out, errst) => {
      if (err) {
        console.error(`Error bringing window to front: ${err.message}`);
      }
      if (errst) {
        console.error(`stderr: ${errst}`);
      }
      console.log(`ahk script executed successfully`);
    });
    
    res.send({ message: 'Folder opened successfully' });
  });
//});



// clear a folder
app.post('/clear', (req, res) => {
  const { local } = req.body;
  if (local) {
    // clear local downloads folder
    fs.emptyDir(downloadsPath)
      .then(() => {
        console.log('cleared local folder')
        res.send({ message: 'success' });
      })
      .catch(err => {
        console.log("Error clearing local folder:", err);
        res.send({ message: 'error' });
      });
  } else {
    // clear gdrive downloads folder (only files that the bot uploaded)
    drive.files.list({
      q: `'${gdriveFolderID}' in parents and trashed = false`,
      fields: 'files(id, name)',
    }).then((response) => {
      const files = response.data.files;
      if (!files || files.length === 0) {
        console.log('Clear Gdrive: Folder is already empty');
        res.send({ message: 'success' });
        return;
      }

      const deleteFiles = files.map((file) =>
        drive.files.delete({ fileId: file.id }).then(() => {
          console.log(`Deleted file: ${file.name} (ID: ${file.id})`);
        })
      );

      Promise.all(deleteFiles).then(() => {
        res.send({ message: 'success' });
      }).catch(() => {
        res.send({ message: 'error' });
      });
    }).catch(() => {
      res.send({ message: 'error' });
    });
  }
});

// start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
