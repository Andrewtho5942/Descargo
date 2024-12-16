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



function deleteFileIfExists(path) {
  if (fs.existsSync(path)) {
    //delete the file
    fs.unlink(path, (err) => {
      if (err) {
        console.error(`Error deleting file ${path}:`, err);
      } else {
        console.log(`Deleted file: ${path}`);
      }
    });
  } else {
    console.log('delete file -- file does not exist: ' + path);
  }
}

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
  try {
    drive.files.create({
      resource: {
        name: fileName,
        parents: [gdriveFolderID],
      },
      media: {
        mimeType: 'application/octet-stream',
        body: fs.createReadStream(filePath)
      },
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
      deleteFileIfExists(filePath);
    });
  });
}



const processVideoTitle = (title, removeSubtext) => {
  if (removeSubtext) {
    title = title.replace(/(\[.*?\]|\(.*?\))/g, '') // optionally remove any text in brackets or parenthesis
  }
  return title.replace(/[^a-zA-Z0-9\-',"$: ]/g, '_') // replace special characters with underscores 
    .replace(/\s+/g, ' ') // replace multiple spaces with a space
    .trim(); //remove trailing and leading whitespace
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

const getTitlewShazam = (tempFile, url) => {
  return new Promise((resolve, reject) => {
    console.log('getting title with shazam...');
    // shazam song recognition
    shazam.recognise(tempFile, 'en-US').then(async (result) => {
      if (result) {
        const newTitle = result.track.subtitle + ' - ' + result.track.title;
        console.log('found song: ' + newTitle + ' | link: ' + result.track.url);
        return resolve(newTitle);
      } else {
        // no song found by shazam, fall back on using yt-dlp to fetch the title
        console.log('No song found by shazam! Fetching yt title...')
        const yt_title = await getTitle(url)
        console.log('found yt-title: ' + yt_title);
        return resolve(yt_title);
      }
    });
  });
}

function processFFMPEGLine(newFile, url, lines, totalDuration, timestamp) {
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const [key, value] = line.split('=');
    if (key && value) {
      if (key.trim() === 'out_time_ms') {
        const currentTime = parseInt(value.trim(), 10) / 1000000;
        const progressPercentage = (currentTime / totalDuration) * 100;

        console.log(`Progress: ${progressPercentage.toFixed(2)}%`);

        const message = { progress: progressPercentage.toFixed(2), status: 'in-progress', file: url, timestamp: timestamp, fileName: newFile };
        broadcastProgress(message)
      }
    }
  }
}

// endpoint to handle download requests
app.post('/download', async (req, res) => {
  const { url, format, gdrive, timestamp, outputPath, gdriveKeyPath, gdriveFolderID, removeSubtext, normalizeAudio, useShazam } = req.body;
  updatePaths(outputPath);
  console.log('downloading url: ' + url);


  if (!url) {
    console.log('err - no URL!')
    return res.status(400).send({ error: 'YouTube URL is required.' });
  }


  // Uniquely name the temp file using the timestamp
  let tempFile = Date.parse(timestamp) + '.' + format;
  let tempFilePath = downloadsPath + '\\' + tempFile;
  console.log('temp file: ' + tempFile);


  // Construct yt-dlp command arguments
  let args = [`"${url}"`, '-o', `"${tempFilePath}"`];

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


  let titlePromise = null
  if (!useShazam) {
    titlePromise = getTitle(url);
  }

  activeProcesses[timestamp] = { process: ytDlpProcess, fileName: 'fetching...' }

  // Listen to yt-dlp stderr for debugging
  // ytDlpProcess.stderr.on('data', (data) => {
  //   const lines = data.toString().split('\n');

  //   lines.forEach(line => {
  //     console.log('stderr: ' + line)
  //   });
  // });

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
        const message = { progress: progressPercent, status: 'in-progress', file: url, timestamp: timestamp, fileName: 'fetching...' };
        broadcastProgress(message)
      }
    });
  });


  ytDlpProcess.on('close', async (code) => {
    let cleanedTitle = '';
    if (useShazam) {
      if (normalizeAudio) {
        cleanedTitle = Date.parse(timestamp) + '_normalized';
      } else {
        cleanedTitle = Date.parse(timestamp);
      }
    } else {
      cleanedTitle = processVideoTitle(await titlePromise, removeSubtext);
      console.log(' ------------- cleaned title: ' + cleanedTitle)
    }

    let newFile = cleanedTitle + '.' + format;
    let filePath = downloadsPath + '\\' + newFile;


    if (code !== 0) {
      console.error(`error: yt-dlp exited with code ${code}`);
      res.send({ message: 'failure', file: url, timestamp: timestamp });

      const message = { progress: 0, status: 'error', file: url, timestamp: timestamp, fileName: newFile };
      broadcastProgress(message);
      clearCache(cleanedTitle)
      delete activeProcesses[timestamp];
      return;
    }

    // start the shazam call
    let shazamPromise = null;
    if (useShazam) {
      shazamPromise = getTitlewShazam(tempFilePath, url);
    }

    //optionally normalize the audio
    if (normalizeAudio) {
      const totalDuration = await getTotalDuration(tempFilePath);
      console.log('totalDuration: ' + totalDuration);

      //normalize the audio and save it to the new path (renaming it)
      let ffmpegArgs = [
        '-i', tempFilePath,
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
        '-c:v', 'copy',  //copy video stream without re-encoding
        '-c:a', 'aac',  // re-encode audio to aac
        filePath,
        '-threads', `${os.cpus().length - 1}`,
        '-progress', 'pipe:1',
        '-nostats']

      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

      activeProcesses[timestamp] = { process: ffmpegProcess, fileName: newFile }

      let progressData = '';

      ffmpegProcess.stdout.on('data', (chunk) => {
        progressData += chunk.toString();

        // iterate over data's lines
        const lines = progressData.split('\n');
        processFFMPEGLine(newFile, url, lines, totalDuration, timestamp);
        progressData = lines[lines.length - 1];
      });

      //stderr output for debugging
      ffmpegProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
      });

      ffmpegProcess.on('close', async (code) => {
        console.log(`ffmpeg exited with code ${code}`);
        if (code !== 0) {
          //clean up cached files
          clearCache(cleanedTitle);
          delete activeProcesses[timestamp];

          // notify clients of error
          const errorMessage = { progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile };
          broadcastProgress(errorMessage);
          res.send(errorMessage);
          return;
        } else {
          // rename the file with shazam API from gettitlewshazam
          if (useShazam && shazamPromise) {
            let shazamTitle = await shazamPromise;
            shazamTitle = processVideoTitle(shazamTitle);

            console.log('got title with shazam: ' + shazamTitle);
            let newShazamPath = downloadsPath + '\\' + shazamTitle + '.' + format;

            //rename normalized file with path from shazam
            fs.renameSync(filePath, newShazamPath);

            newFile = shazamTitle + '.' + format;
            filePath = newShazamPath;
          }


          // upload to google drive if necessary
          if (gdrive) {
            const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);

            console.log('Uploading to gdrive', newFile);
            uploadFile(filePath, newFile, drive, gdriveFolderID);
          }

          //delete the file
          deleteFileIfExists(tempFilePath)

          // send completion message to client and service worker
          console.log(`yt-dlp completed successfully.`);
          res.send({ message: 'success', file: url, timestamp: timestamp, fileName: newFile });
          broadcastProgress({ progress: 100, timestamp: timestamp, file: url, status: 'completed', fileName: newFile });
          delete activeProcesses[timestamp];
        }
      });



    } else {
      // rename the file with shazam API from gettitlewshazam or rename it with ytdlp
      if (useShazam && shazamPromise) {
        let shazamTitle = await shazamPromise;
        console.log('got title with shazam: ' + shazamTitle);
        let newShazamPath = downloadsPath + '\\' + shazamTitle + '.' + format;

        fs.renameSync(tempFilePath, newShazamPath);

        newFile = shazamTitle + '.' + format;
        filePath = newShazamPath;

      } else {
        // rename the file to the title fetched by yt-dlp
        fs.renameSync(tempFilePath, filePath);
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
    }
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
    try {
      const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${input}"`;
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          console.error('Error executing ffprobe:', stderr);
          resolve('-1');
          return;
        }
        const duration = parseFloat(stdout.trim());
        console.log('Duration:', duration);
        resolve(duration);
      });
    } catch (e) {
      console.log('error in getTotalDuration: ' + e.message);
    }
  });
}


// download a m3u8 file
app.post('/download_m3u8', async (req, res) => {
  console.log('downloading m3u8 file...');

  const { link, timestamp, title, outputPath, gdrive, gdriveKeyPath, gdriveFolderID, normalizeAudio, downloadm3u8 } = req.body;
  updatePaths(outputPath)


  const m3u8Name = title + '.m3u8';

  let mp4Output = `${title}.mp4`;
  let output_file = `${downloadsPath}/${mp4Output}`;


  const errorMessage = { progress: 0, timestamp: timestamp, file: link, status: 'error', fileName: mp4Output };


  // optionally download the m3u8 file locally first
  let m3u8Location = '';

  if (downloadm3u8) {
    m3u8Location = `${m3u8Path}\\${m3u8Name}`;

    // keep renaming the file if it exists at location
    let index = 1;
    while (fs.existsSync(m3u8Location)) {
      m3u8Location = `${m3u8Path}\\${m3u8Name}_${index}`;
      index++;
    }

    //deleteFileIfExists(m3u8Location);

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
    try {
      fs.writeFileSync(m3u8LocalPath, m3u8Content, 'utf8');
    } catch (e) {
      console.log('error saving m3u8 file locally: ' + e.message);
      broadcastProgress(errorMessage);
      res.send(errorMessage)
      return;
    }
  } else {
    m3u8Location = link;
  }


  //keep renaming the mp4 output until it doesnt already exist
  let index = 1;
  while (fs.existsSync(output_file)) {
    mp4Output = `${title}_${index}.mp4`;
    output_file = `${downloadsPath}/${mp4Output}`;
    index++;
  }

  const totalDuration = await getTotalDuration(link);
  console.log('total duration (in seconds) of the file: ' + totalDuration)


  //execute the ffmpeg command that will download and convert the m3u8 file to an mp4 file:
  //ffmpeg -protocol_whitelist "file,http,https,tcp,tls" -i "<m3u8_link>" -c copy <output_file>.mp4 -progress pipe:1 -nostats 
  console.log('number of cores detected: ' + os.cpus().length)

  let ffmpegArgs = ['-protocol_whitelist', 'file,http,https,tcp,tls',
    '-i', m3u8Location,
    '-c:v', 'copy',  //copy video stream without re-encoding
    '-c:a', 'aac',  // re-encode audio to aac
    output_file,
    '-threads', `${os.cpus().length - 1}`,
    '-progress', 'pipe:1',
    '-nostats']

  if (normalizeAudio) {
    ffmpegArgs.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11'); //optionally normalize the audio
  }

  const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

  activeProcesses[timestamp] = { process: ffmpegProcess, fileName: mp4Output }

  let progressData = '';

  ffmpegProcess.stdout.on('data', (chunk) => {
    progressData += chunk.toString();

    // iterate over data's lines
    const lines = progressData.split('\n');
    processFFMPEGLine(mp4Output, link, lines, totalDuration, timestamp);
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
      const message = { progress: 0, timestamp: timestamp, file: link, status: 'error', fileName: mp4Output };
      broadcastProgress(message)

      //clean up cached files
      clearCache(mp4Output);
    } else {
      if (gdrive) {
        const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);
        console.log('Uploading to gdrive', mp4Output);
        uploadFile(output_file, mp4Output, drive, gdriveFolderID);
      }

      // download completed successfully
      broadcastProgress({ timestamp: timestamp, file: link, progress: 100, status: 'completed', fileName: mp4Output });
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
        console.log('cleared downloads folder')
        fs.emptyDir(m3u8Path)
          .then(() => {
            console.log('cleared m3u8 folder')
            res.send({ message: 'success' });
          })
          .catch(err => {
            console.log("Error clearing m3u8 folder:", err);
            res.send({ message: 'error' });
          });
      })
      .catch(err => {
        console.log("Error clearing downloads folder:", err);
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
