const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const fs = require('fs-extra');
const { google } = require('googleapis');
const path = require('path');

const key = require('./keys/yt-dl-443015-d39da117fe4a.json');
const downloadsPath = "C:\\Users\\andre\\Downloads\\streaming\\yt-downloads";
const gdriveFolderID = "17pMCBUQxJfEYgVvNwKQUcS8n4oRGIE9q";

let clients = [];

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

// function to upload a file to google drive
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
    drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id',
    });
    console.log('File uploaded successfully!');
  } catch (error) {
    console.error('Error uploading file:', error);
  }
}

// endpoint to connect to client and send data back to it
app.get('/progress', (req, res) => {
  // set headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // send a comment to keep the connection alive and add client
  res.write(': connected\n\n');
  clients.push(res);

  // remove the client when the connection is closed
  req.on('close', () => {
    clients = clients.filter(client => client !== res);
  });
});


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

function getTotalDuration(input) {
  return new Promise((resolve, reject) => {
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${input}"`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error('Error executing ffprobe:', stderr);
        reject(err);
        return;
      }
      const duration = parseFloat(stdout.trim());
      console.log('Duration:', duration);
      resolve(duration);
    });
  });
}


//download a m3u8 file
app.post('/download_m3u8', async (req, res) => {
  const { link, timestamp } = req.body;

  let output_name = ''
  const dotIndex = link.indexOf('.');
  if (dotIndex !== -1 && dotIndex < 35) {
    output_name = link.substring(8, dotIndex);
  } else {
    output_name = link.substring(8, 35);
  }
  output_name = output_name.replace('/', '');
  const output_file = `C:/Users/andre/Downloads/streaming/other/${output_name}.mp4`

  const totalDuration = await getTotalDuration(link);
  console.log('total duration (in seconds) of the file: ' + totalDuration)


  //execute the ffmpeg command that will download and convert the m3u8 file to an mp4 file:
  //ffmpeg -protocol_whitelist "file,http,https,tcp,tls" -i "<m3u8_link>" -c copy <output_file>.mp4 -progress pipe:1 -nostats 

  const ffmpegProcess = spawn('ffmpeg', [
    '-protocol_whitelist', 'file,http,https,tcp,tls',
    '-i', link,
    '-c', 'copy',
    output_file,
    '-progress', 'pipe:1',
    '-nostats',
  ]);

  let progressData = '';

  ffmpegProcess.stdout.on('data', (chunk) => {
    progressData += chunk.toString();

    // iterate over data's lines
    const lines = progressData.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      const [key, value] = line.split('=');
      if (key && value) {
        if (key.trim() === 'out_time_ms') {
          const currentTime = parseInt(value.trim(), 10) / 1000000;
          const progressPercentage = (currentTime / totalDuration) * 100;

          console.log(`Progress: ${progressPercentage.toFixed(2)}%`);

          const message = `data: ${JSON.stringify({ progress: progressPercentage.toFixed(2), status: 'in-progress', file: link, timestamp:timestamp })}\n\n`;
          clients.forEach(client => client.write(message));

          // if complete, close all the client connections
          if (progressPercentage == 100) {
            clients.forEach(client => client.end());
            clients = [];
          }
        }
      }
    }

    // Keep the last line (could be incomplete) for the next chunk
    progressData = lines[lines.length - 1];
  });

  //stderr output for debugging
  ffmpegProcess.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`ffmpeg exited with code ${code}`);
    if (code !== 0) {
      // notify clients of error
      const message = `data: ${JSON.stringify({ progress: 0, status: 'error' })}\n\n`;
      clients.forEach(client => client.write(message));

      // close all client connections
      clients.forEach(client => client.end());
      clients = [];
    }
  });
  //res.send({ message: 'Folder opened successfully' });
});




//open a folder
app.post('/open', (req, res) => {
  //execute the autohotkey script that will open and focus file explorer
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
