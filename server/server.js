const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const kill = require('tree-kill');
const fs = require('fs-extra');
const fs_promises = require('fs').promises;
const { google } = require('googleapis');
const path = require('path');
const axios = require('axios');
const os = require('os');
const { Shazam } = require('node-shazam');
const shazam = new Shazam();

let downloadsPath = "";
let m3u8Path = "";


let activeProcesses = {};


let clients = [];

const app = express();
const PORT = 5001;

// middleware
app.use(cors());
app.use(bodyParser.json());


// send a message to every client
function broadcastProgress(message) {
  clients.forEach(client => client.write(`data: ${JSON.stringify(message)}\n\n`));
}

app.get('/', (req, res) => {
  console.log('connection detected');
  res.send('hello, world!');
})

// shazam.recognise("C:\\Users\\andre\\Downloads\\streaming\\downloads\\Avenged Sevenfold - Hail To The King.m4a", 'en-US').then((result) => {
//   console.log('found song: '+result.track.subtitle + ' - '+result.track.title+' | link: '+result.track.url);
// });


// function to get the most recently modified file in a folder
// function getMostRecentFile(dir) {
//   const files = fs.readdirSync(dir); // Read all files in the directory
//   let latestFile = null;
//   let latestTime = 0;

//   files.forEach((file) => {
//     const filePath = path.join(dir, file);
//     const stat = fs.statSync(filePath);

//     if (stat.isFile() && stat.mtimeMs > latestTime) {
//       latestFile = filePath;
//       latestTime = stat.mtimeMs;
//     }
//   });

//   return latestFile;
// }

function createGdriveAuth(gdriveFolderID, keyPath) {
  //const key = require('./keys/yt-dl-443015-d39da117fe4a.json');

  const auth = new google.auth.GoogleAuth({
    credentials: require(keyPath),
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  return google.drive({ version: 'v3', auth });
}

async function ensureDirectoryExists(dirPath) {
  try {
    await fs_promises.mkdir(dirPath, { recursive: true });
    console.log(`Directory ensured: ${dirPath}`);
  } catch (err) {
    console.error(`Error creating directory: ${err.message}`);
  }
}

function updatePaths(outputPath) {
  downloadsPath = outputPath + '\\downloads';
  m3u8Path = outputPath + '\\m3u8';

  // make sure these folders exist
  ensureDirectoryExists(downloadsPath);
  ensureDirectoryExists(m3u8Path);
}

// function to upload a file to google drive
async function uploadFile(filePath, fileName, drive, gdriveFolderID) {
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
  res.write(`data: ${JSON.stringify({ message: 'connected' })}\n\n`);
  clients.push(res);

  // remove the client when the connection is closed
  req.on('close', () => {
    clients = clients.filter(client => client !== res);
  });
});


// Function to delete files that match a given prefix
function clearCache(fileName) {
  // Read all files in the directory
  fs.readdir(downloadsPath, (err, files) => {
    if (err) {
      console.error(`Error reading directory ${directory}:`, err);
      return;
    }

    // Filter files that start with the given prefix
    const matchingFiles = files.filter(file => file.startsWith(fileName));
    console.log(`Clear cache -- matching files: ${matchingFiles.join(', ')}`);

    // Loop through matching files
    matchingFiles.forEach(file => {
      const filePath = path.join(downloadsPath, file);

      //delete the file
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error(`Error deleting file ${filePath}:`, err);
        } else {
          console.log(`Deleted file: ${filePath}`);
        }
      });
    });
  });
}



const processVideoTitle = (title) => {
  return title.replace(/(\[.*?\]|\(.*?\))/g, '') //remove any text in brackets or parenthesis
    .replace(/[^a-zA-Z0-9\-',"$: ]/g, '_') // replace special characters with underscores 
    .replace(/\s+/g, ' ')         // replace multiple spaces with a space
    .trim();
};

const getTitle = (url) => {
  return new Promise((resolve, reject) => {
    try {
      // Command to get the title
      exec(`yt-dlp --get-title "${url}"`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error: ${error.message}`);
          return resolve('unknown')
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
          return resolve('unknown')
        }
        const title = stdout.trim();
        console.log('got title: ' + title);
        return resolve(title);
      });
    } catch (e) {
      console.log('error getting title: ' + e.message)
      return resolve('unkown');
    }
  });
}


// endpoint to handle download requests
app.post('/download', async (req, res) => {
  console.log('downloading file...');

  const { url, format, gdrive, timestamp, outputPath, gdriveKeyPath, gdriveFolderID, removeSubtext, normalizeAudio, useShazam } = req.body;
  updatePaths(outputPath);

  console.log('download link: ' + url);

  const cleanedTitle = processVideoTitle(await getTitle(url));
  console.log('cleaned title: ' + cleanedTitle)

  if (!url) {
    console.log('err - no URL!')
    return res.status(400).send({ error: 'YouTube URL is required.' });
  }


  //rename the file
  let newFile = cleanedTitle + '.' + format;
  let filePath = downloadsPath + '\\' + newFile;
  console.log('new file: ' + newFile);


  // Construct yt-dlp command arguments
  let args = [`"${url}"`, '-o', `"${filePath}"`];
  console.log('format: ' + format)

  if (format === 'mp4') {
    args.push('-f', 'bv+ba/b', '--merge-output-format', 'mp4');
  } else {
    args.push('-f', 'ba/b', '-f', 'm4a');
  }

  console.log('spawning yt-dlp with args: ')
  console.log(args)

  // Initialize yt-dlp process
  const ytDlpProcess = spawn('yt-dlp', args
    , {
      cwd: downloadsPath,
      shell: true,
    }
  );

  // normalize the yt-dlp audio when the download is done? Need to change original download path, and very time consuming:
  // ffmpeg -i "C:\Users\andre\Downloads\streaming\downloads\Moore_s_Law_is_Dead_Welcome_to_Light_Speed_Computers.mp4" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:v copy "C:\Users\andre\Downloads\streaming\downloads\Moore_s_Law_is_Dead_Welcome_to_Light_Speed_Computers_new.mp4"

  activeProcesses[timestamp] = { process: ytDlpProcess, fileName: newFile }

  // Listen to yt-dlp stderr for debugging
  ytDlpProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');

    lines.forEach(line => {
      console.log('stderr: ' + line)
    });
  });

  // Listen to yt-dlp stdout for progress updates
  ytDlpProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');

    lines.forEach(line => {
      // Example yt-dlp progress line:
      // [download]   1.2% of 10.00MiB at 1.00MiB/s ETA 00:09
      const progressMatch = line.match(/\[download\]\s+(\d+(\.\d+)?)% of/);
      if (progressMatch) {
        const progressPercent = parseFloat(progressMatch[1]);
        console.log('download progress: ' + progressPercent);

        // Broadcast progress to clients with timestamp
        const message = { progress: progressPercent, status: 'in-progress', file: url, timestamp: timestamp, fileName: newFile };
        broadcastProgress(message)
      }
    });
  });


  ytDlpProcess.on('close', async (code) => {
    if (code !== 0) {
      console.error(`error: yt-dlp exited with code ${code}`);
      res.send({ message: 'failure', file: url, timestamp: timestamp });

      const message = { progress: 0, status: 'error', file: url, timestamp: timestamp, fileName: newFile };
      broadcastProgress(message);
      clearCache(cleanedTitle)
      delete activeProcesses[timestamp];
      return;
    }


    // upload to google drive if necessary
    if (gdrive) {
      const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);

      console.log('Uploading to gdrive', newFile);
      uploadFile(filePath, newFile, drive, gdriveFolderID);
    }


    // send completion message to client and service worker
    console.log(`yt-dlp completed successfully.`);
    res.send({ message: 'success', file: url, timestamp: timestamp, fileName: newFile });

    broadcastProgress({ progress: 100, timestamp: timestamp, file: url, status: 'completed', fileName: newFile });


    delete activeProcesses[timestamp];
  });

  ytDlpProcess.on('error', (error) => {
    console.error(`Error executing yt-dlp: ${error.message}`);
    res.send({ message: 'failure', timestamp: timestamp });
    broadcastProgress({ progress: 0, timestamp: historyEntry.timestamp, file: url, status: 'error', fileName: newFile });
    delete activeProcesses[timestamp];
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


// download a m3u8 file
app.post('/download_m3u8', async (req, res) => {
  console.log('downloading m3u8 file...');

  const { link, timestamp, title, outputPath, gdrive, gdriveKeyPath, gdriveFolderID, normalizeAudio } = req.body;
  updatePaths(outputPath)

  // const fileName = title + '--' + Date.parse(timestamp);
  const m3u8Name = title + '.m3u8';
  const errorMessage = { progress: 0, timestamp: timestamp, file: link, status: 'error', fileName: m3u8Name };


  // download the m3u8 file locally first
  let m3u8Response = null;
  try {
    m3u8Response = await axios.get(link, { responseType: 'text', timeout: 10000 });
    if (!m3u8Response) {
      console.log('error getting m3u8: no response')
      // notify clients of error
      broadcastProgress(errorMessage)
      res.send(errorMessage)
      return;
    }
  } catch (e) {
    console.log('error getting m3u8: ' + e.message)
    broadcastProgress(errorMessage);
    res.send(errorMessage)
    return;
  }

  const m3u8Content = m3u8Response.data;
  // Save the .m3u8 file locally
  const m3u8LocalPath = `${m3u8Path}\\${m3u8Name}`;
  try {
    fs.writeFileSync(m3u8LocalPath, m3u8Content, 'utf8');
  } catch (e) {
    console.log('error saving m3u8 file locally: ' + e.message);
    broadcastProgress(errorMessage);
    res.send(errorMessage)
    return;
  }

  const mp4Output = `${title}.mp4`

  const output_file = `${downloadsPath}/${mp4Output}`

  const totalDuration = await getTotalDuration(link);
  console.log('total duration (in seconds) of the file: ' + totalDuration)


  //execute the ffmpeg command that will download and convert the m3u8 file to an mp4 file:
  //ffmpeg -protocol_whitelist "file,http,https,tcp,tls" -i "<m3u8_link>" -c copy <output_file>.mp4 -progress pipe:1 -nostats 
  console.log('number of cores detected: ' + os.cpus().length)
  const ffmpegProcess = spawn('ffmpeg', [
    '-protocol_whitelist', 'file,http,https,tcp,tls',
    '-i', m3u8LocalPath,
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', // normalize audio
    '-c:v', 'copy',  //copy video stream without re-encoding
    '-c:a', 'aac',  // re-encode audio to aac
    output_file,
    '-threads', `${os.cpus().length - 1}`,
    '-progress', 'pipe:1',
    '-nostats',
  ]);

  activeProcesses[timestamp] = { process: ffmpegProcess, fileName: m3u8Name }

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

          const message = { progress: progressPercentage.toFixed(2), status: 'in-progress', file: link, timestamp: timestamp, fileName: m3u8Name };
          broadcastProgress(message)
        }
      }
    }

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
      const message = { progress: 0, timestamp: timestamp, file: link, status: 'error', fileName: m3u8Name };
      broadcastProgress(message)

      //clean up cached files
      clearCache(title)
    } else {

      if (gdrive) {
        const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);
        console.log('Uploading to gdrive', mp4Output);
        uploadFile(output_file, mp4Output, drive, gdriveFolderID);
      }

      // download completed successfully
      broadcastProgress({ timestamp: timestamp, file: link, progress: 100, status: 'completed', fileName: m3u8Name });
    }

    delete activeProcesses[timestamp];
  });
});



// stop a specific download
app.post('/stop_download', (req, res) => {
  const { timestamp } = req.body;

  const processItem = activeProcesses[timestamp];

  if (processItem) {
    const process = processItem.process;
    // Kill the process
    console.log('attempting to kill process ' + process.pid);
    try {
      kill(process.pid, 'SIGINT', (err) => {
        if (err) {
          console.error(`Failed to kill process ${process.pid}:`, err);
          return res.status(500).send({ message: 'Error stopping download' });
        }
        console.log('KILLED PROCESS ------ ' + process.pid);

        delete activeProcesses[timestamp];

        res.send({ message: 'Success: Download stopped' });
        return;
      })
    } catch (e) {
      console.log('error when killing process: ' + e.message);
    }
  } else {
    res.send({ message: 'ERROR: Download not found' });
  }
});

// app.post('/kill_processes', (req, res) => {
//   console.log('--- killing all active processes ---');


//   Object.values(activeProcesses).forEach(processInfo => {
//     console.log('Process:', processInfo);
//     // Access the process and perform actions
//     const process = processInfo.process;
//     console.log('attempting to kill process ' + process.pid);
//     try {
//       kill(process.pid, 'SIGINT', (err) => {
//         if (err) {
//           console.error(`Failed to kill process ${process.pid}:`, err);
//           res.status(500).send({ message: 'Error stopping download' });
//           return;
//         }
//         console.log('KILLED PROCESS ------ ' + process.pid);
//       })
//     } catch (e) {
//       console.log('error when killing processes: ' + e.message)
//       return;
//     }
//   });
//   activeProcesses = {};
//   res.send({ message: 'success' })
// });

app.post('/kill_processes', async (req, res) => {
  console.log('--- killing all active processes ---');

  const killPromises = Object.values(activeProcesses).map(processInfo => {
    const process = processInfo.process;
    console.log('Attempting to kill process ' + process.pid);

    return new Promise((resolve, reject) => {
      try {
        kill(process.pid, 'SIGINT', (err) => {
          if (err) {
            console.error(`Failed to kill process ${process.pid}:`, err);
            reject(err);
          } else {
            console.log('KILLED PROCESS ------ ' + process.pid);
            resolve();
          }
        });
      } catch (e) {
        console.error('Error when killing processes:', e.message);
        reject(e);
      }
    });
  });

  try {
    await Promise.all(killPromises);
    activeProcesses = {};
    res.send({ message: 'Success: All processes stopped' });
  } catch (err) {
    console.error('One or more processes failed to stop:', err);
    res.send({ message: 'Error stopping some processes', error: err.message });
  }
});



//open a folder
app.post('/open', (req, res) => {

  //execute the autohotkey script that will open and focus file explorer
  const { focusExplorerPath, AHKPath, outputPath } = req.body;
  updatePaths(outputPath);

  exec(`"${AHKPath}" "${focusExplorerPath}" "${downloadsPath}"`, (err, out, errst) => {
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
  const { type, outputPath, gdriveKeyPath, gdriveFolderID } = req.body;
  updatePaths(outputPath);

  if (type === 'local-downloads') {
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
  } else if (type === 'gdrive-downloads') {
    const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);
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
  } else if (type === 'local-m3u8') {
    // clear local downloads folder
    fs.emptyDir(m3u8Path)
      .then(() => {
        console.log('cleared m3u8 folder')
        res.send({ message: 'success' });
      })
      .catch(err => {
        console.log("Error clearing m3u8 folder:", err);
        res.send({ message: 'error' });
      });
  } else {
    console.log('clear folder: unknown type --> ' + type);
  }
});

// start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
