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


let max_concurrent_downloads = 10;
let num_downloads = 0;
let abortAllPlaylists = false;

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
    console.log('file does not already exist: ' + path);
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
      }).then(() => {
        console.log('File uploaded successfully!');
        resolve();
        return;
      }).catch((e) => {
        console.error('Error uploading file:', error);
        resolve();
        return;
      });
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
  return title.replace(/[^a-zA-Z0-9\-',"$'.()[\]*%#@!^{}<>+=&~`; ]/g, '_') // replace special characters with underscores 
    .replace(/\s+/g, ' ') // replace multiple spaces with a space
    .trim(); //remove trailing and leading whitespace
};

const getTitle = (url, cookiePath, newFile, removeSubtext, format) => {
  return new Promise((resolve, reject) => {
    getTitleMain(url, cookiePath, newFile, removeSubtext, format);

    function getTitleMain(url, cookiePath, newFile, removeSubtext, format) {
      try {
        // Command to get the title
        let command = `yt-dlp --get-title "${url}" -f mhtml`

        if (cookiePath) {
          command += ` --cookies "${cookiePath.replace(/\\/g, '/')}"`;
        }
        console.log('getTitle command: ' + command)
        exec(command, (error, stdout, stderr) => {
          if (error) {
            console.error(`get title Error: ${error.message}`);
            if (cookiePath) {
              //try again without cookies
              getTitleMain(url, '', newFile, removeSubtext, format);
              return;
            }

            newFile.value = 'unknown.' + format;
            return resolve(newFile.value)
          }
          if (stderr) {
            console.error(`get title stderr: ${stderr}`);
          }
          const title = stdout.trim();
          const cleanedTitle = processVideoTitle(title, removeSubtext);
          console.log('got processed YT title: ' + cleanedTitle);
          newFile.value = cleanedTitle + '.' + format;

          return resolve(newFile.value);
        });
      } catch (e) {
        console.log('error getting title: ' + e.message)
        if (cookiePath) {
          //try again without cookies
          getTitleMain(url, '', newFile, removeSubtext, format);
          return;
        }
        newFile.value = 'unknown.' + format;
        return resolve(newFile.value);
      }
    }

  });
}

const getTitlewShazam = (tempFile, url, cookiePath, newFile, removeSubtext, format) => {
  return new Promise((resolve, reject) => {
    console.log('getting title with shazam...');
    // shazam song recognition

    shazam.recognise(tempFile, 'en-US').then(async (result) => {
      if (result) {
        const newTitle = result.track.subtitle + ' - ' + result.track.title;

        const processedTitle = processVideoTitle(newTitle, removeSubtext);
        console.log('found song: ' + processedTitle + ' | link: ' + result.track.url);
        newFile.value = processedTitle + '.' + format;
        return resolve(newFile.value);
      } else {
        // no song found by shazam, fall back on using yt-dlp to fetch the title
        console.log('No song found by shazam! Fetching yt title...')
        const yt_title = await getTitle(url, cookiePath, newFile, removeSubtext, format)
        return resolve(yt_title);
      }
    }).catch(async (e) => {
      console.log('ERROR getting title with shazam: ' + e.message);
      console.log('using yt-dlp to fetch and clean the title...');

      // fall back on using yt-dlp to fetch the title
      const yt_title = await getTitle(url, cookiePath, newFile, removeSubtext, format);
      return resolve(yt_title);
    });
  });
}

function processFFMPEGLine(fileName, url, lines, totalDuration, timestamp) {
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const [key, value] = line.split('=');
    if (key && value) {
      if (key.trim() === 'out_time_ms') {
        const currentTime = parseInt(value.trim(), 10) / 1000000;
        const progressPercentage = (currentTime / totalDuration) * 100;

        console.log(`ffmpeg progress: ${progressPercentage.toFixed(2)}%`);

        const message = { progress: progressPercentage.toFixed(2), status: 'in-progress', file: url, timestamp: timestamp, fileName: fileName };
        broadcastProgress(message)
      }
    }
  }
}

function ytdlpDownload(bodyObject) {
  num_downloads++;

  return new Promise((resolve, reject) => {
    ytdlpMain(bodyObject);

    // wrap the main process in another function to enable retries on error
    function ytdlpMain(bodyObjectInner) {
      console.log('ytdlpMain arguments:');
      console.log(bodyObjectInner);

      const { url, format, gdrive, timestamp, outputPath, gdriveKeyPath, gdriveFolderID,
        removeSubtext, normalizeAudio, useShazam, cookiePath, maxDownloads } = bodyObjectInner;

      max_concurrent_downloads = maxDownloads || 10;
      console.log('updated max_concurrent downloads to ' + max_concurrent_downloads)

      updatePaths(outputPath);

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

      console.log('spawning yt-dlp..')
      console.log(args)

      // Initialize yt-dlp process
      const ytDlpProcess = spawn('yt-dlp', args
        , {
          cwd: tempFolderPath,
          shell: true,
        }
      );

      let newFile = { value: 'fetching... ' }
      let titlePromise = null
      if (!useShazam) {
        console.log('calling getTitle...')
        titlePromise = getTitle(url, cookiePath, newFile, removeSubtext, format);
      }

      activeProcesses[timestamp] = { process: ytDlpProcess, fileName: newFile.value }

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
            console.log('ytdlp progress: ' + progressPercent);

            // Broadcast progress to clients with timestamp
            const message = { progress: progressPercent, status: 'in-progress', file: url, timestamp: timestamp, fileName: newFile.value };
            broadcastProgress(message)
          }
        });
      });


      ytDlpProcess.on('close', async (code) => {
        if (code !== 0) {
          console.error(`error: yt-dlp exited with code ${code}`);

          //retry the yt-dlp process but without cookies
          if (cookiePath) {
            console.log('Retrying without cookies...');
            ytdlpMain({ ...bodyObject, cookiePath: '' });
            return;
          }

          const message = { progress: 0, status: 'error', file: url, timestamp: timestamp, fileName: newFile.value };
          broadcastProgress(message);
          clearCache(newFile.value, timestamp)
          delete activeProcesses[timestamp];
          resolve({ message: 'failure', file: url, timestamp: timestamp });
          return;
        }

        if (useShazam) {
          if (normalizeAudio) {
            newFile.value = Date.parse(timestamp) + '_normalized.' + format;
          } else {
            newFile.value = Date.parse(timestamp) + '.' + format;
          }
        } else {
          await titlePromise;
          console.log(' ------------- cleaned title: ' + newFile.value)
        }

        let filePath = tempFolderPath + '\\' + newFile.value;


        // start the shazam call
        let shazamPromise = null;
        if (useShazam) {
          shazamPromise = getTitlewShazam(tempFilePath, url, cookiePath, newFile, removeSubtext, format);
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

          activeProcesses[timestamp] = { process: ffmpegProcess, fileName: newFile.value }

          let progressData = '';

          ffmpegProcess.stdout.on('data', (chunk) => {
            progressData += chunk.toString();

            // iterate over data's lines
            const lines = progressData.split('\n');
            processFFMPEGLine(newFile.value, url, lines, totalDuration, timestamp);
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
              clearCache(newFile.value, timestamp);
              delete activeProcesses[timestamp];

              // notify clients of error
              const errorMessage = { progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile.value };
              broadcastProgress(errorMessage);
              resolve(errorMessage);
              return;
            } else {
              // rename the file with shazam API from gettitlewshazam
              if (useShazam && shazamPromise) {
                await shazamPromise;

                console.log('got title with shazam: ' + newFile.value);
                let newShazamPath = tempFolderPath + '\\' + newFile.value;

                //rename normalized file with path from shazam
                try {
                  fs.renameSync(filePath, newShazamPath);
                } catch (e) {
                  console.log('ERROR renaming file: ' + e.message)
                  //clean up cached files
                  clearCache(newFile.value, timestamp);
                  delete activeProcesses[timestamp];

                  // notify clients of error
                  const errorMessage = { progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile.value };
                  broadcastProgress(errorMessage);
                  resolve(errorMessage);
                  return;
                }
                filePath = newShazamPath;
              }


              // upload to google drive if necessary
              if (gdrive) {
                const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);

                console.log('Uploading to gdrive', newFile.value);
                await uploadFile(filePath, newFile.value, drive, gdriveFolderID);
              }

              try {
                let permFile = downloadsPath + '\\' + newFile.value
                //delete the file
                deleteFileIfExists(tempFilePath)
                deleteFileIfExists(permFile)

                //move the file from temp to downloads
                fs.moveSync(filePath, permFile)

                clearCache(newFile.value, timestamp)
              } catch (e) {
                console.log('ERR completing download: ' + e.message)
              }

              // send completion message to client and service worker
              console.log(`yt-dlp completed successfully.`);
              broadcastProgress({ progress: 100, timestamp: timestamp, file: url, status: 'completed', fileName: newFile.value });
              delete activeProcesses[timestamp];
              resolve({ message: 'success', file: url, timestamp: timestamp, fileName: newFile.value });
              return;
            }
          });



        } else {
          // rename the file with shazam API from gettitlewshazam or rename it with ytdlp
          try {
            if (useShazam && shazamPromise) {
              await shazamPromise;
              console.log('got title with shazam: ' + newFile.value);
              let newShazamPath = tempFolderPath + '\\' + newFile.value;

              fs.renameSync(tempFilePath, newShazamPath);

              filePath = newShazamPath;
            } else {
              // rename the file to the title fetched by yt-dlp
              fs.renameSync(tempFilePath, filePath);
            }
          } catch (e) {
            console.log('ERROR renaming file: ' + e.message)

            //clean up cached files
            clearCache(newFile.value, timestamp);
            delete activeProcesses[timestamp];

            // notify clients of error
            const errorMessage = { progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile.value };
            broadcastProgress(errorMessage);
            resolve(errorMessage);
            return;
          }


          // upload to google drive if necessary
          if (gdrive) {
            const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);

            console.log('Uploading to gdrive', newFile.value);
            await uploadFile(filePath, newFile.value, drive, gdriveFolderID);
          }

          try {
            let permFile = downloadsPath + '\\' + newFile.value;
            deleteFileIfExists(permFile);

            //move the file from temp to downloads
            fs.moveSync(filePath, permFile);

            clearCache(newFile.value, timestamp);

          } catch (e) {
            console.log('ERR completing download: ' + e.message)
          }

          // send completion message to client and service worker
          console.log(`yt-dlp completed successfully.`);
          broadcastProgress({ progress: 100, timestamp: timestamp, file: url, status: 'completed', fileName: newFile.value });
          setTimeout(() => { }, 500); //wait half a second to make sure broadcast sent

          console.log('DEBUG -_-_-_-_ SENT COMPLETION BROADCAST: ' + newFile.value);
          delete activeProcesses[timestamp];
          resolve({ message: 'success', file: url, timestamp: timestamp, fileName: newFile.value });
          return;
        }
      });

      ytDlpProcess.on('error', (error) => {
        console.error(`Error executing yt-dlp: ${error.message}`);
        broadcastProgress({ progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile.value });
        delete activeProcesses[timestamp];
        resolve({ message: 'failure', timestamp: timestamp });
        return;
      });

    }
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

  const { link, timestamp, title, outputPath, gdrive, gdriveKeyPath, gdriveFolderID, normalizeAudio, downloadm3u8, maxDownloads } = req.body;

  max_concurrent_downloads = maxDownloads || 10;
  console.log('updated max_concurrent downloads to ' + max_concurrent_downloads)

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
  abortAllPlaylists = true; // set the abort playlists flag to stop new videos from being downloaded
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

  console.log('downloadsPath: ' + downloadsPath);
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
  abortAllPlaylists = false;

  const { playlistURL, format, gdrive, outputPath, gdriveKeyPath, gdriveFolderID, removeSubtext, normalizeAudio, useShazam, cookiePath, maxDownloads } = req.body;
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
      console.log('#### num downloads: ' + num_downloads + '/' + max_concurrent_downloads);
      while (num_downloads >= max_concurrent_downloads) {
        console.log('WARN: Max concurrent downloads reached, cur: ' + num_downloads + '! Polling until there is room...')
        await delay(1000); // Check every second if there is room to start the download
      }

      if (abortAllPlaylists) {
        break;
      }

      url = videoURLs[urlNo];

      console.log('---- playlist: downloading ' + url);
      let timestamp = new Date().toISOString();
      bodyObject = { url, format, gdrive, timestamp, outputPath, gdriveKeyPath, gdriveFolderID, removeSubtext, normalizeAudio, useShazam, cookiePath, maxDownloads };

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
