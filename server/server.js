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


const MAX_CONCURRENT_DOWNLOADS = 10
let num_downloads = 0;

let downloadsPath = "";
let m3u8Path = "";
let tempFolderPath = "";


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
    fs.unlinkSync(path);
    console.log('deleted the file: ' + path)
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
  tempFolderPath = outputPath + "\\temp"

  // make sure these folders exist
  ensureDirectoryExists(downloadsPath);
  ensureDirectoryExists(m3u8Path);
  ensureDirectoryExists(tempFolderPath);
}

// function to upload a file to google drive
async function uploadFile(filePath, fileName, drive, gdriveFolderID) {
  return new Promise((resolve, reject) => {

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
      resolve();
      return;
    } catch (error) {
      console.error('Error uploading file:', error);
      resolve();
      return;
    }
  })
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
function clearCache(fileName, timestamp) {
  // Read all files in the directory
  fs.readdir(tempFolderPath, (err, files) => {
    if (err) {
      console.error(`Error reading directory ${directory}:`, err);
      return;
    }

    // Filter files that start with the given prefix
    const matchingFiles = files.filter(file => (file.startsWith(fileName)) || (file.startsWith(timestamp)));
    console.log(`Clear cache -- matching files: ${matchingFiles.join(', ')}`);

    // Loop through matching files
    matchingFiles.forEach(file => {
      const filePath = path.join(tempFolderPath, file);

      //delete the file
      deleteFileIfExists(filePath);
    });
  });
}



const processVideoTitle = (title, removeSubtext) => {
  if (removeSubtext) {
    title = title.replace(/(\[.*?\]|\(.*?\))/g, '') // optionally remove any text in brackets or parenthesis
  }
  return title.replace(/[^a-zA-Z0-9\-',"$:'. ]/g, '_') // replace special characters with underscores 
    .replace(/\s+/g, ' ') // replace multiple spaces with a space
    .trim(); //remove trailing and leading whitespace
};

const getTitle = (url, cookiePath) => {
  return new Promise((resolve, reject) => {
    try {
      // Command to get the title
      let command = `yt-dlp --get-title "${url}"`

      if (cookiePath) {
        command += ` --cookies "${cookiePath.replace(/\\/g, '/')}"`;
      }

      exec(command, (error, stdout, stderr) => {
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

const getTitlewShazam = (tempFile, url, cookiePath) => {
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
        const yt_title = await getTitle(url, cookiePath)
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

function ytdlpDownload(bodyObject) {
  num_downloads++;
  return new Promise((resolve, reject) => {

    const { url, format, gdrive, timestamp, outputPath, gdriveKeyPath, gdriveFolderID,
      removeSubtext, normalizeAudio, useShazam, cookiePath } = bodyObject;
    updatePaths(outputPath);
    console.log('downloading url: ' + url);


    if (!url) {
      console.log('err - no URL!')
      resolve({ error: 'YouTube URL is required.' })
      return;
    }


    // Uniquely name the temp file using the timestamp
    let tempFile = Date.parse(timestamp) + '.' + format;
    let tempFilePath = tempFolderPath + '\\' + tempFile;
    console.log('temp file: ' + tempFile);


    // Construct yt-dlp command arguments
    let args = [`"${url}"`, '-o', `"${tempFilePath}"`];

    if (cookiePath) {
      args.push('--cookies', `"${cookiePath.replace(/\\/g, '/')}"`);
    }

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
        cwd: tempFolderPath,
        shell: true,
      }
    );


    let titlePromise = null
    if (!useShazam) {
      titlePromise = getTitle(url, cookiePath);
    }

    activeProcesses[timestamp] = { process: ytDlpProcess, fileName: 'fetching...' }

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
          const message = { progress: progressPercent, status: 'in-progress', file: url, timestamp: timestamp, fileName: 'fetching... ' };
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
      let filePath = tempFolderPath + '\\' + newFile;


      if (code !== 0) {
        console.error(`error: yt-dlp exited with code ${code}`);

        const message = { progress: 0, status: 'error', file: url, timestamp: timestamp, fileName: newFile };
        broadcastProgress(message);
        clearCache(cleanedTitle, timestamp)
        delete activeProcesses[timestamp];
        resolve({ message: 'failure', file: url, timestamp: timestamp });
        return;
      }

      // start the shazam call
      let shazamPromise = null;
      if (useShazam) {
        shazamPromise = getTitlewShazam(tempFilePath, url, cookiePath);
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
            clearCache(cleanedTitle, timestamp);
            delete activeProcesses[timestamp];

            // notify clients of error
            const errorMessage = { progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile };
            broadcastProgress(errorMessage);
            resolve(errorMessage);
            return;
          } else {
            // rename the file with shazam API from gettitlewshazam
            if (useShazam && shazamPromise) {
              let shazamTitle = await shazamPromise;
              shazamTitle = processVideoTitle(shazamTitle);

              console.log('got title with shazam: ' + shazamTitle);
              let newShazamPath = tempFolderPath + '\\' + shazamTitle + '.' + format;

              //rename normalized file with path from shazam
              fs.renameSync(filePath, newShazamPath);

              newFile = shazamTitle + '.' + format;
              filePath = newShazamPath;
            }


            // upload to google drive if necessary
            if (gdrive) {
              const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);

              console.log('Uploading to gdrive', newFile);
              await uploadFile(filePath, newFile, drive, gdriveFolderID);
            }

            try {
              let permFile = downloadsPath + '\\' + newFile
              //delete the file
              deleteFileIfExists(tempFilePath)
              deleteFileIfExists(permFile)

              //move the file from temp to downloads
              fs.moveSync(filePath, permFile)

              clearCache(newFile, timestamp)
            } catch (e) {
              console.log('ERR completing download: ' + e.message)
            }

            // send completion message to client and service worker
            console.log(`yt-dlp completed successfully.`);
            broadcastProgress({ progress: 100, timestamp: timestamp, file: url, status: 'completed', fileName: newFile });
            delete activeProcesses[timestamp];
            resolve({ message: 'success', file: url, timestamp: timestamp, fileName: newFile });
            return;
          }
        });



      } else {
        // rename the file with shazam API from gettitlewshazam or rename it with ytdlp
        if (useShazam && shazamPromise) {
          let shazamTitle = await shazamPromise;
          console.log('got title with shazam: ' + shazamTitle);
          let newShazamPath = tempFolderPath + '\\' + shazamTitle + '.' + format;

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
          await uploadFile(filePath, newFile, drive, gdriveFolderID);
        }

        try {
          let permFile = downloadsPath + '\\' + newFile;
          deleteFileIfExists(permFile);

          //move the file from temp to downloads
          fs.moveSync(filePath, permFile);

          clearCache(newFile, timestamp);

        } catch (e) {
          console.log('ERR completing download: ' + e.message)
        }

        // send completion message to client and service worker
        console.log(`yt-dlp completed successfully.`);
        broadcastProgress({ progress: 100, timestamp: timestamp, file: url, status: 'completed', fileName: newFile });
        setTimeout(() => { }, 500); //wait half a second to make sure broadcast sent

        console.log('DEBUG -_-_-_-_ SENT COMPLETION BROADCAST: ' + newFile);
        delete activeProcesses[timestamp];
        resolve({ message: 'success', file: url, timestamp: timestamp, fileName: newFile });
        return;
      }
    });

    ytDlpProcess.on('error', (error) => {
      console.error(`Error executing yt-dlp: ${error.message}`);
      broadcastProgress({ progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile });
      delete activeProcesses[timestamp];
      resolve({ message: 'failure', timestamp: timestamp });
      return;
    });
  });
}

// endpoint to handle download requests
app.post('/download', async (req, res) => {
  res.send(await ytdlpDownload(req.body));
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
  num_downloads++;

  const { link, timestamp, title, outputPath, gdrive, gdriveKeyPath, gdriveFolderID, normalizeAudio, downloadm3u8 } = req.body;
  updatePaths(outputPath)


  const m3u8Name = title + '.m3u8';

  let mp4Output = `${title}.mp4`;
  let output_file = `${tempFolderPath}/${mp4Output}`;


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
        num_downloads--;
        res.send(errorMessage)
        return;
      }
    } catch (e) {
      console.log('error getting m3u8: ' + e.message)
      broadcastProgress(errorMessage);
      num_downloads--;
      res.send(errorMessage)
      return;
    }

    const m3u8Content = m3u8Response.data;
    // Save the .m3u8 file locally
    try {
      fs.writeFileSync(m3u8Location, m3u8Content, 'utf8');
    } catch (e) {
      console.log('error saving m3u8 file locally: ' + e.message);
      broadcastProgress(errorMessage);
      num_downloads--;
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
    output_file = `${tempFolderPath}/${mp4Output}`;
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

  ffmpegProcess.on('close', async (code) => {
    console.log(`ffmpeg exited with code ${code}`);
    if (code !== 0) {
      // notify clients of error
      const message = { progress: 0, timestamp: timestamp, file: link, status: 'error', fileName: mp4Output };
      broadcastProgress(message)

      //clean up cached files
      clearCache(mp4Output, timestamp);

    } else {
      if (gdrive) {
        const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);
        console.log('Uploading to gdrive', mp4Output);
        await uploadFile(output_file, mp4Output, drive, gdriveFolderID);
      }
      try {
        let permFile = downloadsPath + '\\' + mp4Output;
        deleteFileIfExists(permFile);

        //move the file from temp to downloads
        fs.moveSync(output_file, permFile);

        clearCache(mp4Output, timestamp);
      } catch (e) {
        console.log('ERR completing download: ' + e.message)
      }
      // download completed successfully
      broadcastProgress({ timestamp: timestamp, file: link, progress: 100, status: 'completed', fileName: mp4Output });
      num_downloads--;
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
        num_downloads--;
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
    num_downloads = 0;
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

            fs.emptyDir(tempFolderPath)
              .then(() => {
                console.log('cleared temp folder')
                res.send({ message: 'success' });
              })
              .catch(err => {
                console.log("Error clearing temp folder:", err);
                res.send({ message: 'error' });
              });
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// start a playlist download 
app.post('/playlist', (req, res) => {
  const { playlistURL, format, gdrive, outputPath, gdriveKeyPath, gdriveFolderID, removeSubtext, normalizeAudio, useShazam, cookiePath } = req.body;
  console.log('received playlist request!');

  let command = `yt-dlp --flat-playlist -j "${playlistURL}"`

  if (cookiePath) {
    command += ` --cookies "${cookiePath.replace(/\\/g, '/')}"`
  }

  exec(command, async (error, stdout, stderr) => {
    if (error) {
      const message = 'ERR in flatten playlist - ' + error.message;
      console.log(message);
      res.send({ message: message });
      return;
    }

    const videoURLs = stdout.split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line).url);

    const firstVideo = JSON.parse(stdout.split('\n')[0].trim());
    const playlistName = firstVideo.playlist_title + ' -- ' + firstVideo.playlist_channel;
    console.log('-----playlistName: ');
    console.log(playlistName);


    console.log('video urls:');
    console.log(videoURLs);

    // console.log('stderr:')
    // console.log(stderr)

    const downloadPromises = [];
    // download each video
    for (urlNo in videoURLs) {
      console.log('num downloads: ' + num_downloads)
      while (num_downloads >= MAX_CONCURRENT_DOWNLOADS) {
        console.log('WARN: Max concurrent downloads reached! Polling until there is room...')
        await delay(1000); // Check every second if there is room to start the download
      }

      url = videoURLs[urlNo];

      console.log('---- playlist: downloading ' + url);
      let timestamp = new Date().toISOString();
      bodyObject = { url, format, gdrive, timestamp, outputPath, gdriveKeyPath, gdriveFolderID, removeSubtext, normalizeAudio, useShazam, cookiePath };

      const dlPromise = ytdlpDownload(bodyObject).finally(() => { num_downloads-- });
      downloadPromises.push(dlPromise);

      // wait for half a second to not overload the server
      await delay(500);
    }

    await Promise.all(downloadPromises)
    console.log('All downloads are completed!')
    const message = { status: 'playlist-completed', playlistName: playlistName };
    broadcastProgress(message)
    res.send({ message: 'playlist downloaded successfully!' })
  });
});


// start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
