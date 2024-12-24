const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const axios = require('axios');

const os = require('os');
const fs = require('fs-extra');
const fs_promises = require('fs').promises;

const kill = require('tree-kill');
const { google } = require('googleapis');
const path = require('path');
const { Shazam } = require('node-shazam');
const shazam = new Shazam();
const util = require('util');

const execAsync = util.promisify(exec);

process.env.LANG = 'en_US.UTF-8';


let max_concurrent_downloads = 10;
let num_downloads = 0;
let abortAllPlaylists = false;
let killOverride = false;


let downloadsPath = "";
let tempFolderPath = "C:\\Users\\andre\\Downloads\\Descargo\\temp";


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


// Function to format time for SRT
function formatTime(seconds) {
  const date = new Date(0);
  date.setSeconds(seconds);
  const iso = date.toISOString().substr(11, 12);
  return iso.replace('.', ',');
}

function readJsonFromFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        console.error('Error reading the file:', err);
        reject(err);
        return;
      }

      try {
        const jsonData = JSON.parse(data);
        resolve(jsonData);
      } catch (parseError) {
        console.error('Error parsing JSON:', parseError);
        reject(parseError);
      }
    });
  });
}

function transcribeWithWhisper(videoPath, jsonPath, file, timestamp, fileName, totalDuration) {
  return new Promise(async (resolve, reject) => {

    const process = spawn('python', [
      '-u', '-m', 'whisper',
      `"${videoPath}"`,
      '--language', 'en',
      '--output_format', 'json',
      '--output_dir', `"${tempFolderPath}"`,
      '--condition_on_previous_text', 'False',
    ], { shell: true });

    activeProcesses[timestamp] = { process: process, fileName: fileName }


    process.stdout.on('data', (data) => {
      const lines = data.toString('utf8').split('\n');
      lines.forEach((line) => {
        console.log('stdout: ' + line);

        if (line.trim().startsWith('[')) {
          // process the line into the end timestamp
          try {
            endTimeTokens = line.split('  ')[0].split(' ')[2].replace(']', '').split(':');
            endTimeSecs = (parseInt(endTimeTokens[0]) * 60) + (parseInt(endTimeTokens[1].split('.')[0]));
          } catch (e) {
            const msg = 'error parsing whisper output: ' + e.message
            console.log(msg)
            return;
          }
          const progressPercentage = ((endTimeSecs / totalDuration) * 100).toFixed(2)
          console.log('progress: ' + progressPercentage + '%');
          const message = { progress: progressPercentage, status: 'in-progress', file: file, timestamp: timestamp, fileName: fileName, task: 'Transcribing...' };
          broadcastProgress(message)
        }
      });
    });


    process.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Whisper process exited with code ${code}`));
      }

      readJsonFromFile(jsonPath).then((data) => {
        // delete the temporary JSON file
        deleteFileIfExists(jsonPath)

        delete activeProcesses[timestamp];
        return resolve(data);
      }).catch((e) => {
        delete activeProcesses[timestamp];
        const msg = 'ERROR: ' + e.message;
        console.log(msg)
        return reject(new Error(msg))
      })
    });
  });
}


function applySubtitles(videoPath, srtPath, outputPath) {
  return new Promise((resolve, reject) => {
    // add the subtitles to the video with ffmpeg
    const command = `ffmpeg -i "${videoPath}" -i "${srtPath}" -c:v copy -c:a copy -c:s mov_text "${outputPath}"`;

    console.log('adding subtitles with command: ' + command);

    deleteFileIfExists(outputPath);

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error adding subtitles: ${error.message}`);
        return resolve();
      }
      console.log('Subtitles added successfully.');
      return resolve();
    });
  })
}


// Generate and save SRT content, then apply it to the video
// confidence threshold: 5e-10: too leniant, 2e-10: minor mistakes on both, 1e-10: too strict
function generateSubtitles(videoPath, outputPath, file, timestamp, fileName, confidenceThreshold = 2e-10, maxDuration = 8) {
  return new Promise(async (resolve, reject) => {
    const srtPath = videoPath.slice(0, videoPath.lastIndexOf('.')) + '.srt';
    const jsonPath = videoPath.slice(0, videoPath.lastIndexOf('.')) + '.json';

    const totalDuration = await getTotalDuration(videoPath)
    console.log('total duration (in seconds) of the file: ' + totalDuration)

    transcribeWithWhisper(videoPath, jsonPath, file, timestamp, fileName, totalDuration).then((whisperResults) => {
      // readJsonFromFile("C:\\Users\\andre\\Downloads\\Descargo\\subtitles\\test_whisper_output_old.json").then((whisperResults) => { // bypass whisper for debugging and directly use json file

      let srtContent = '';
      let index = 1;

      // filter out low confidence whisper results
      whisperResults.segments.filter(segment => segment.no_speech_prob < confidenceThreshold)
        .forEach(segment => {
          let start = formatTime(segment.start);
          let end = formatTime(segment.end);

          let text = segment.text;

          // crop the long segments and keep the last part
          if (segment.end - segment.start > maxDuration) {
            start = formatTime(segment.end - maxDuration);
          }
          // prevent the last segment from going over the length of the video
          if (segment.end > totalDuration) {
            end = formatTime(totalDuration);
          }
          srtContent += `${index}\n${start} --> ${end}\n${text}\n\n`;
          index++;
        });

      srtContent = srtContent.trim();

      console.log('Writing to srt file: ' + srtPath)

      fs.writeFileSync(srtPath, srtContent, { encoding: 'utf-8' });

      applySubtitles(videoPath, srtPath, outputPath).then(() => {
        // delete temp srt file
        deleteFileIfExists(srtPath)
        return resolve();
      });
    }).catch((e) => {
      const msg = 'ERROR generating subtitles: ' + e.message
      console.log(msg);
      return reject(msg);
    });
  });
}

//generateSubtitles("C:\\Users\\andre\\Downloads\\Descargo\\subtitles\\Everything Stays _ Adventure Time.mp4", tempFolderPath + '\\test2.mp4')


// deletes an entire folder, be careful when calling this one
function deleteFolderIfExists(path) {
  if (fs.existsSync(path)) {
    //delete the folder
    fs.rmSync(path, { recursive: true, force: true });
    console.log('deleted the folder: ' + path)
  } else {
    console.log('folder does not already exist: ' + path);
  }
}

// deletes a file
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
  tempFolderPath = outputPath + "\\temp"

  // make sure these folders exist
  ensureDirectoryExists(downloadsPath);
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
  try {
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

  } catch (e) {
    console.log('ERROR CLEARING CACHE: ' + e);
  }
}

const processVideoTitle = (title, removeSubtext) => {
  if (removeSubtext) {
    title = title.replace(/(\[.*?\]|\(.*?\))/g, '') // optionally remove any text in brackets or parenthesis
  }
  return title.replace(/[^a-zA-Z0-9\-',$'.()[\]%#@!^{}+=&~`; ]/g, '_') // replace special characters with underscores 
    .replace(/\s+/g, ' ') // replace multiple spaces with a space
    .trim(); //remove trailing and leading whitespace
};

const getTitle = (url, cookiePath, newFile, removeSubtext, format) => {
  return new Promise((resolve, reject) => {
    getTitleMain(url, cookiePath, newFile, removeSubtext, format, ` -f mhtml`);

    function getTitleMain(url, cookiePath, newFile, removeSubtext, format, storyboardFormat) {
      try {
        // Command to get the title
        let command = `yt-dlp --get-title "${url}"` + storyboardFormat;

        if (cookiePath) {
          command += ` --cookies "${cookiePath.replace(/\\/g, '/')}"`;
        }
        console.log('getTitle command: ' + command)
        exec(command, (error, stdout, stderr) => {
          if (error) {
            console.error(`get title Error: ${error.message}`);
            if (cookiePath && !killOverride) {
              console.log('trying again without cookies...')
              getTitleMain(url, '', newFile, removeSubtext, format, storyboardFormat);
              return;
            }
            if (storyboardFormat && !killOverride) {
              console.log('trying again without specifying format...')
              getTitleMain(url, '', newFile, removeSubtext, format, '');
              return;
            }
            // done retrying, just default to unknown
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
        console.log('error getting title: ' + e)
        if (cookiePath) {
          console.log('trying again without cookies...')
          getTitleMain(url, '', newFile, removeSubtext, format);
          return;
        }
        newFile.value = 'unknown.' + format;
        return resolve(newFile.value);
      }
    }

  });
}

const extractAudio = (videoFile, outputAudioFile) => {
  return new Promise((resolve, reject) => {
    console.log(`Extracting audio from ${videoFile}...`);
    const command = `ffmpeg -i "${videoFile}" -vn -acodec aac -b:a 192k "${outputAudioFile}"`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error extracting audio: ${stderr}`);
        return reject(error);
      }
      console.log(`Audio extracted to ${outputAudioFile}`);
      resolve(outputAudioFile);
    });
  });
};

const getTitlewShazam = (tempFile, url, cookiePath, newFile, removeSubtext, format, m3u8Title) => {
  return new Promise(async (resolve, reject) => {
    console.log('getting title with shazam...');
    // shazam song recognition
    let len = 0;
    if (format === 'mp4') {
      len = await getTotalDuration(tempFile)
      if (len < 600) {
        const audioFilePath = tempFile.replace(/\.[^/.]+$/, '.m4a');
        deleteFileIfExists(audioFilePath);

        // if the format is a video, extract the audio and use that for shazam
        try {
          await extractAudio(tempFile, audioFilePath);
          tempFile = audioFilePath;
        } catch (e) {
          console.log('ERROR extracting audio for shazam: ' + e);
          if (m3u8Title) {
            console.log('falling back to the original m3u8 title...');
            return resolve({ title: m3u8Title });
          } else {
            console.log('using yt-dlp to fetch and clean the title...');
            const yt_title = await getTitle(url, cookiePath, newFile, removeSubtext, format);
            return resolve({ title: yt_title });
          }
        }
      }
    }

    console.log('\n\ntempfile: ' + tempFile + '\n')

    shazam.recognise(tempFile, 'en-US').then(async (result) => {
      if (result) {
        console.log('shazam result: ')
        console.log(result)

        const newTitle = result.track.subtitle + ' - ' + result.track.title;

        const processedTitle = processVideoTitle(newTitle, removeSubtext);
        console.log('found song: ' + processedTitle + ' | link: ' + result.track.url);
        newFile.value = processedTitle + '.' + format;

        const metadata = {
          title: result.track.title,
          artist: result.track.subtitle,
          genre: result.track.genres?.primary || 'Unknown Genre',
          comment: `${result.track.url}`
        };

        if ((format === 'mp4') && (len < 300)) deleteFileIfExists(tempFile)
        return resolve({ title: newFile.value, metadata: metadata });
      } else {
        // no song found by shazam, fall back on using yt-dlp to fetch the title
        console.log('No song found by shazam! Fetching yt title...')
        const yt_title = await getTitle(url, cookiePath, newFile, removeSubtext, format)

        if ((format === 'mp4') && (len < 300)) deleteFileIfExists(tempFile)
        return resolve({ title: yt_title });
      }
    }).catch(async (e) => {
      console.log('ERROR getting title with shazam: ' + e);
      if (m3u8Title) {
        console.log('falling back to the original m3u8 title...');

        if ((format === 'mp4') && (len < 300)) deleteFileIfExists(tempFile)
        return resolve({ title: m3u8Title });
      } else {
        console.log('using yt-dlp to fetch and clean the title...');

        // fall back on using yt-dlp to fetch the title
        const yt_title = await getTitle(url, cookiePath, newFile, removeSubtext, format);

        if ((format === 'mp4') && (len < 300)) deleteFileIfExists(tempFile)
        return resolve({ title: yt_title });
      }
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

        const message = { progress: progressPercentage.toFixed(2), status: 'in-progress', file: url, timestamp: timestamp, fileName: fileName, task: 'Normalizing...' };
        broadcastProgress(message)
      }
    }
  }
}

function findPermPath(desiredFileName, format) {
  let permPath = `${downloadsPath}\\${desiredFileName}`;
  index = 0;

  let desiredName = desiredFileName.slice(0, desiredFileName.lastIndexOf('.'))
  console.log('desiredName: ' + desiredName)

  // increment the permpath index until it finds a name that isnt already taken 
  while (fs.existsSync(permPath)) {
    index++;
    permPath = `${downloadsPath}\\${desiredName}_${index}.${format}`
  }
  return permPath;
}

async function finishUpload(generateSubs, format, gdrive, resolve, filePath, newFile, gdriveFolderID,
  gdriveKeyPath, url, timestamp, start) {

  try {
    let permPath = findPermPath(newFile.value, format);

    //move the file from temp to downloads OR generate the subtitles and write the mp4 with subititles to the permPath
    if (generateSubs && (format === 'mp4')) {
      await generateSubtitles(filePath, permPath, url, timestamp, newFile.value);
      // upload the file with captions to google drive
      if (gdrive) {
        const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);

        console.log('Uploading to gdrive', newFile.value);
        await uploadFile(permPath, newFile.value, drive, gdriveFolderID);
      }
    } else {
      // upload to google drive if necessary
      if (gdrive) {
        const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);

        console.log('Uploading to gdrive', newFile.value);
        await uploadFile(filePath, newFile.value, drive, gdriveFolderID);
      }

      deleteFileIfExists(permPath);
      fs.moveSync(filePath, permPath);
    }

    clearCache(newFile.value, timestamp,);
    console.log(`yt-dlp completed successfully.`);

    let durationSecs = Math.round((Date.now() - start) / 1000);
    const minutes = Math.trunc(durationSecs / 60).toString().padStart(2, '0');
    const seconds = (durationSecs % 60).toString().padStart(2, '0');
    const timeString = `${minutes}:${seconds}`
    // send completion message to client and service worker
    broadcastProgress({ progress: 100, timestamp: timestamp, file: url, status: 'completed', fileName: newFile.value, timeSpent: timeString });

    console.log('DEBUG -_-_-_-_ SENT COMPLETION BROADCAST: ' + newFile.value);
    console.log(`Download time: ${timeString}`);
    delete activeProcesses[timestamp];
    resolve({ message: 'success', file: url, timestamp: timestamp, fileName: newFile.value });

  } catch (e) {
    console.log('ERR completing download: ' + e.message);
    broadcastProgress({ progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile.value });
    delete activeProcesses[timestamp];
    resolve({ message: 'failure', file: url, timestamp: timestamp, fileName: newFile.value });
  }
}

function ytdlpDownload(bodyObject) {
  let start = Date.now()
  num_downloads++;

  return new Promise((resolve, reject) => {
    ytdlpMain(bodyObject);

    // wrap the main process in another function to enable retries on error
    function ytdlpMain(bodyObjectInner) {
      console.log('ytdlpMain arguments:');
      console.log(bodyObjectInner);

      const { url, format, gdrive, timestamp, outputPath, gdriveKeyPath, gdriveFolderID, removeSubtext,
        normalizeAudio, useShazam, cookiePath, maxDownloads, generateSubs, m3u8Title, useAria2c } = bodyObjectInner;

      max_concurrent_downloads = maxDownloads || 10;
      console.log('updated max_concurrent downloads to ' + max_concurrent_downloads)

      updatePaths(outputPath);


      // Uniquely name the temp file using the timestamp
      let tempFile = Date.parse(timestamp) + '.' + format;
      let tempFilePath = tempFolderPath + '\\' + tempFile;
      console.log('temp file: ' + tempFile);


      // Construct yt-dlp command arguments
      let args = [`"${url}"`, '-o', `"${tempFilePath}"`];

      if (cookiePath) {
        args.push('--cookies', `"${cookiePath.replace(/\\/g, '/')}"`);
      }

      // use aria2c to download the video concurrently 24 segments at a time
      if (useAria2c) {
        // args.push('--external-downloader', 'aria2c', '--external-downloader-args', 
        //   '"--console-log-level=notice --max-concurrent-downloads=8 --max-tries=10 --retry-wait=3 -k 2M --continue -l C:\\Users\\andre\\Downloads\\Descargo\\aria2c.log"',
        //    '--retries', '10', '--fragment-retries', '10', '--verbose')
        args.push('--progress-template', '"Downloading: %(progress._percent_str)s @ %(progress.speed)s ETA %(progress.eta)s"',
          '--concurrent-fragments', '8',
          '--retries', '10',
          '--fragment-retries', '10')
      }

      if (format === 'mp4') {
        args.push('-f', 'bv+ba/b', '--merge-output-format', 'mp4');
      } else {
        args.push('-f', 'ba/b', '-f', 'm4a');
      }

      console.log('spawning yt-dlp..')
      console.log(args)


      let prevData = -1;
      let noRestart = false;
      // Initialize yt-dlp process
      const ytDlpProcess = spawn('yt-dlp', args
        , {
          cwd: tempFolderPath,
          shell: true,
        }
      );

      let newFile = { value: 'fetching... ' }
      if (m3u8Title) {
        newFile.value = m3u8Title + '.mp4';
      }

      let titlePromise = null
      if (!useShazam && !m3u8Title) {
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
          if (useAria2c) {
            try {
              if (line.includes('Downloading: ')) {
                const progressPercent = line.match(/Downloading:\s+(\d+(\.\d+)?)%/)[1];
                if (prevData != progressPercent) {
                  prevData = progressPercent;
                  console.log('aria2c progress: ' + progressPercent)

                  // Broadcast progress to clients with timestamp
                  const message = { progress: progressPercent, status: 'in-progress', file: url, timestamp: timestamp, fileName: newFile.value, task: 'Downloading...' };
                  broadcastProgress(message)
                }
              } else if (line.includes('fragment not found; Skipping fragment ')) {
                noRestart = true;
              } else {
                console.log('stdout: ' + line)
              }
            } catch (e) {
              console.log('ERROR in aria2c progress parsing: ' + e.message);
              return;
            }
          } else {
            const progressMatch = line.match(/\[download\]\s+(\d+(\.\d+)?)% of/);
            if (progressMatch) {
              const progressPercent = parseFloat(progressMatch[1]);
              if (progressPercent !== prevData) {
                prevData = progressPercent;
                console.log('ytdlp progress: ' + progressPercent);
                // Broadcast progress to clients with timestamp
                const message = { progress: progressPercent, status: 'in-progress', file: url, timestamp: timestamp, fileName: newFile.value, task: 'Downloading...' };
                broadcastProgress(message)
              }
            } else if (line.includes('Giving up after ')) {
              noRestart = true;
            }
          }
        });
      });


      ytDlpProcess.on('close', async (code) => {
        if (code !== 0 && !noRestart) {
          console.error(`error: yt-dlp exited with code ${code}`);

          //retry the yt-dlp process but without cookies
          if (cookiePath && !killOverride) {
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
          shazamPromise = getTitlewShazam(tempFilePath, url, cookiePath, newFile, removeSubtext, format, m3u8Title);
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

              finishUpload(generateSubs, format, gdrive, resolve, filePath, newFile, gdriveFolderID, gdriveKeyPath, url, timestamp, start);

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

          finishUpload(generateSubs, format, gdrive, resolve, filePath, newFile, gdriveFolderID, gdriveKeyPath,
            url, timestamp, start);

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
  res.send(await ytdlpDownload(req.body).finally(() => { num_downloads-- }));
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



// stop a specific download
app.post('/stop_download', async (req, res) => {
  try {
    const { timestamp } = req.body;

    const processItem = activeProcesses[timestamp];

    if (processItem) {
      const process = processItem.process;

      killOverride = true;

      // Kill the process
      console.log('attempting to kill process ' + process.pid);


      try {
        function killProcess() {
          return new Promise((resolve, reject) => {
            kill(process.pid, 'SIGINT', (err) => {
              if (err) {
                console.error(`Failed to kill process ${process.pid}:`, err);
                resolve();
                return res.status(500).send({ message: 'Error stopping download' });
              }
              console.log('KILLED PROCESS ------ ' + process.pid);

              delete activeProcesses[timestamp];

              resolve();

              res.send({ message: 'Success: Download stopped' });
              return;
            });
          });
        }

        await killProcess();
        killOverride = false;
      } catch (e) {
        console.log('error when killing process: ' + e.message);
      }
    } else {
      res.send({ message: 'ERROR: Download not found' });
    }
  } catch (e) {
    console.error(`Failed to stop process:`, err);
    return res.status(500).send({ message: 'Error stopping download' });
  }
});


app.post('/kill_processes', async (req, res) => {
  console.log('--- killing all active processes ---');
  abortAllPlaylists = true; // set the abort playlists flag to stop new videos from being downloaded
  killOverride = true;

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
    killOverride = false;
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
    fs.emptyDir(downloadsPath).then(() => {
      console.log('cleared downloads folder')

      fs.emptyDir(tempFolderPath).then(() => {
        console.log('cleared temp folder')
        res.send({ message: 'success' });
      }).catch(err => {
        console.log("Error clearing temp folder:", err);
        res.send({ message: 'error' });
      });
    }).catch(err => {
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

  const { playlistURL, format, gdrive, outputPath, gdriveKeyPath, gdriveFolderID, removeSubtext,
    normalizeAudio, useShazam, cookiePath, maxDownloads, generateSubs, m3u8Title, useAria2c } = req.body;
  console.log('received playlist request!');

  let command = `yt-dlp --flat-playlist -j "${playlistURL}"`

  if (cookiePath) {
    command += ` --cookies "${cookiePath.replace(/\\/g, '/')}"`
  }

  exec(command, async (error, stdout, stderr) => {
    if (error) {
      const message = 'ERR in flatten playlist - ' + error.message;
      console.log(message);
      res.send({ message: 'error' });
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


    const downloadPromises = [];
    // download each video
    for (urlNo in videoURLs) {
      console.log('#### num downloads: ' + num_downloads + '/' + max_concurrent_downloads);
      while (num_downloads >= max_concurrent_downloads) {
        console.log('WARN: Max concurrent downloads reached, cur: ' + num_downloads + '! Polling until there is room...')
        await delay(1000); // Check every three seconds if there is room to start the download
      }

      if (abortAllPlaylists) {
        break;
      }

      url = videoURLs[urlNo];

      console.log('---- playlist: downloading ' + url);
      let timestamp = new Date().toISOString();
      bodyObject = {
        url, format, gdrive, timestamp, outputPath, gdriveKeyPath, gdriveFolderID, removeSubtext,
        normalizeAudio, useShazam, cookiePath, maxDownloads, generateSubs, m3u8Title, useAria2c
      };

      const dlPromise = ytdlpDownload(bodyObject).finally(() => { num_downloads-- });
      downloadPromises.push(dlPromise);

      // wait for half a second to not overload the server
      await delay(500);
    }

    await Promise.all(downloadPromises)
    console.log('All downloads are completed!')
    const message = { status: 'playlist-completed', playlistName: playlistName };
    broadcastProgress(message)
    res.send({ message: 'success' })
  });
});



// start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});











// ------------ deprecated code ------------


// download a m3u8 file (obsolete)
app.post('/download_m3u8', async (req, res) => {
  let start = Date.now()
  res.send(await download_m3u8_main(req.body).finally(num_downloads--));

  function download_m3u8_main(bodyObject) {
    return new Promise(async (resolve, reject) => {
      console.log('downloading m3u8 file...');
      num_downloads++;

      const { link, timestamp, title, outputPath, gdrive, gdriveKeyPath, gdriveFolderID, normalizeAudio, downloadm3u8, maxDownloads, generateSubs } = bodyObject;

      max_concurrent_downloads = maxDownloads || 10;
      console.log('updated max_concurrent downloads to ' + max_concurrent_downloads)

      updatePaths(outputPath)

      const timestampString = Date.parse(timestamp);

      const m3u8Name = title + "_" + timestampString + '.m3u8';

      let tempFile = `${title}_${timestampString}.mp4`;
      let tempPath = `${tempFolderPath}\\${tempFile}`;
      let permFile = `${title}.mp4`
      let permPath = downloadsPath + '\\' + permFile;


      const errorMessage = { progress: 0, timestamp: timestamp, file: link, status: 'error', fileName: permFile };


      // optionally download the m3u8 file locally first
      let m3u8Location = '';

      if (downloadm3u8) {
        console.log('downloading m3u8 locally...')
        m3u8Location = `${m3u8Path}\\${m3u8Name}`;


        let m3u8Response = null;
        try {
          m3u8Response = await axios.get(link, { responseType: 'text', timeout: 10000 });
          if (!m3u8Response) {
            console.log('error getting m3u8: no response')
            // notify clients of error
            broadcastProgress(errorMessage)
            return resolve(errorMessage);
          }
        } catch (e) {
          console.log('error getting m3u8: ' + e.message)
          broadcastProgress(errorMessage);
          return resolve(errorMessage);
        }

        const m3u8Content = m3u8Response.data;
        // Save the .m3u8 file locally
        console.log('saving m3u8 file to ' + m3u8Location)
        try {
          fs.writeFileSync(m3u8Location, m3u8Content, 'utf8');
        } catch (e) {
          console.log('error saving m3u8 file locally: ' + e.message);
          broadcastProgress(errorMessage);
          return resolve(errorMessage);
        }
      } else {
        m3u8Location = link;
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
        tempPath,
        '-threads', `${os.cpus().length - 1}`,
        '-progress', 'pipe:1',
        '-nostats']

      if (normalizeAudio) {
        ffmpegArgs.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11'); //optionally normalize the audio
      }

      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

      activeProcesses[timestamp] = { process: ffmpegProcess, fileName: permFile }

      let progressData = '';

      ffmpegProcess.stdout.on('data', (chunk) => {
        progressData += chunk.toString();

        // iterate over data's lines
        const lines = progressData.split('\n');
        processFFMPEGLine(permFile, link, lines, totalDuration, timestamp);
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
          broadcastProgress(errorMessage)

          //clean up cached files
          clearCache(tempFile, timestamp, m3u8Dir = m3u8Location);
          delete activeProcesses[timestamp];
          return resolve(errorMessage);
        }


        try {

          //move the file from temp to downloads OR generate the subtitles and write the mp4 with subititles to the permFile
          if (generateSubs) {
            await generateSubtitles(tempPath, permPath, link, timestamp, permFile);
            // upload the file with captions to google drive
            if (gdrive) {
              const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);

              console.log('Uploading to gdrive', permFile);
              await uploadFile(permPath, permFile, drive, gdriveFolderID);
            }
          } else {
            // upload to google drive if necessary
            if (gdrive) {
              const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath);

              console.log('Uploading to gdrive', newFile.value);
              await uploadFile(filePath, permFile, drive, gdriveFolderID);
            }

            deleteFileIfExists(permPath);
            fs.moveSync(tempPath, permPath);
          }

          clearCache(permFile, timestamp);
          console.log(`m3u8 ffmpeg completed successfully.`);
          let timeSpent = Math.round((Date.now() - start) / 1000)

          // send completion message to client and service worker
          broadcastProgress({ progress: 100, timestamp: timestamp, file: link, status: 'completed', fileName: permFile, timeSpent: timeSpent });
          //setTimeout(() => { }, 500); //wait half a second to make sure broadcast sent

          console.log('DEBUG -_-_-_-_ SENT COMPLETION BROADCAST: ' + permFile);
          console.log(`regular m3u8 download of ${permFile} took ${timeSpent} seconds.`)

          delete activeProcesses[timestamp];
          return resolve({ message: 'success', file: link, timestamp: timestamp, fileName: permFile });

        } catch (e) {
          console.log('ERR completing download: ' + e.message);
          broadcastProgress(errorMessage);
          delete activeProcesses[timestamp];
          return resolve(errorMessage);
        }
      });
    });
  }
});

// aria2c functions:
// a function for each of the five steps of the process. But a sixth was made in secret. One function to rule them all, and in the darkness, bind them.

// parses the m3u8 file and writes an input file for aria2c to use while downloading the video segments
function generateInputFile(streamFilePath, outputFile) {
  console.log('generating aria2c input file from m3u8...')

  const content = fs.readFileSync(streamFilePath, 'utf8');
  const lines = content.split('\n');
  const segments = [];

  lines.forEach((line, index) => {
    if (line.startsWith('#EXTINF')) {

      const duration = parseFloat(line.split(':')[1]);
      const url = lines[index + 1]?.trim();
      if (url && url.startsWith('http')) {
        segments.push({ duration, url, index });
      }
    }
  });

  const urls = segments.map(segment => `${segment.url}\n  out=${segment.index}.ts`).join('\n');
  fs.writeFileSync(outputFile, urls);

  console.log('...done writing input file to ' + outputFile);
}

// download the m3u8 file in segments concurrently using the generated input file to a temp directory
function aria2cDownload(inputFile, tempFolder) {
  deleteFolderIfExists(tempFolder);
  const totalLines = (fs.readFileSync(inputFile, 'utf8').split('\n').length) / 2;
  console.log('### totalLines: ' + totalLines)
  //const ariaOutputRegex = /\[.*?\]/;
  console.log('starting aria2cDownload...')

  return new Promise(async (resolve, reject) => {

    // TODO: Change this to use spawn, calculate percent done by dividing number of completed segments by total number of segmentss
    const ariaProcess = spawn('aria2c', [
      '-i', `"${inputFile}"`,
      '-d', `"${tempFolder}"`,
      '--max-concurrent-downloads=24',
      '--max-tries=3',
      '--retry-wait=2'
    ], { shell: true });

    // parse the output to generate live progress updates
    let lineCount = 0;
    ariaProcess.stdout.on('data', (data) => {
      let lines = data.toString().split('\n');
      for (let line of lines) {
        // if (ariaOutputRegex.test(line)) {
        if (line.includes('Download complete')) {
          lineCount++;
          let progressPercent = ((lineCount / totalLines) * 100).toFixed(2);
          //console.log('stdout: ' + line);
          console.log(`progress: ${progressPercent}%`)
        } else if (line.trim() !== '') {
          console.log('stdout: ' + line)
        }
      }
    })

    // Listen to yt-dlp stderr for debugging
    ariaProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        console.log('stderr: ' + line)
      });
    });

    ariaProcess.on('close', (code) => {
      console.log(`...aria2cDownload finished with code ${code}`);
      resolve();
    });

    ariaProcess.on('error', (error) => {
      console.log('ERROR in aria download: ' + error.message);
      resolve();
    });
  });
}

// remuxes the temp files
function remuxSegments(inputDir, outputDir) {
  deleteFolderIfExists(outputDir);
  ensureDirectoryExists(outputDir);

  return new Promise((resolve, reject) => {
    console.log('remuxing video segments...')

    fs.readdir(inputDir, async (err, files) => {
      ffmpegPromises = files.map(async (file) => {

        const inputFilePath = inputDir + '\\' + file;
        const outputFilePath = outputDir + '\\' + 'rem.' + file;
        // const ffmpegCommand = `ffmpeg -i "${inputFilePath}" -c copy -bsf:v h264_mp4toannexb -f mpegts "${outputFilePath}" -threads ${os.cpus().length - 1}`;
        //new command for re-encoding
        const ffmpegCommand = `ffmpeg -i "${inputFilePath}" -fflags +genpts -c copy -bsf:v h264_mp4toannexb -f mpegts "${outputFilePath}" -threads ${os.cpus().length - 1}`;

        try {
          //console.log(ffmpegCommand)
          await execAsync(ffmpegCommand);
        } catch (ffmpegError) {
          console.error(`Error processing ${file}: ${ffmpegError.message}`);
        }
      });
      await Promise.all(ffmpegPromises);
      console.log('...done remuxing')
      resolve();
    });

  });
}

// write the merge file that is used to combine the remuxed files in the next step
function generateMergeFile(tempDirectory, outputFile) {
  console.log('generating the merge file for ffmpeg...')
  fs.readdir(tempDirectory, (err, files) => {

    // Sort files by numeric index (e.g., 0.ts, 1.ts)
    const sortedFiles = files.sort((a, b) => {
      const aIndex = parseInt(a.split('.')[1], 10);
      const bIndex = parseInt(b.split('.')[1], 10);
      return aIndex - bIndex;
    });

    const mergeFileContent = sortedFiles.map((file) => `file '${tempDirectory}\\${file}'`).join('\n');
    fs.writeFileSync(outputFile, mergeFileContent);
  })
  console.log('... done')
}

// use ffmpeg to combine the remuxed video segments into an mp4 output file
function ffmpegCombine(mergeFile, outputMp4) {
  deleteFileIfExists(outputMp4);

  return new Promise((resolve, reject) => {
    console.log('combining remuxed files...')
    //exec(`ffmpeg -f concat -safe 0 -i ${mergeFile} -c copy ${outputMp4}`, (err, stdout, stderr) => {
    exec(`ffmpeg -f concat -safe 0 -i ${mergeFile} -c:v libx264 -crf 23 -c:a aac -b:a 128k ${outputMp4} -threads ${os.cpus().length - 1}`, (err, stdout, stderr) => {
      console.log(`... done combining remuxed files into ${outputMp4}`)
      resolve();
    });
  });
}

// --- driving function for the above five functions ---
async function downloadWAria2c(inputM3u8, outputMp4) {
  console.log('downloading m3u8 with aria2c...')
  let start = Date.now()
  let aria2cFolder = "C:\\Users\\andre\\Downloads\\Descargo\\aria2c"
  generateInputFile(aria2cFolder + "\\stream_2.m3u8", aria2cFolder + "\\input.txt");
  await aria2cDownload(aria2cFolder + "\\input.txt", aria2cFolder + "\\temp-folder");
  await remuxSegments(aria2cFolder + "\\temp-folder", aria2cFolder + "\\remuxed-folder");
  generateMergeFile(aria2cFolder + "\\remuxed-folder", aria2cFolder + "\\mergeFile.txt");
  await ffmpegCombine(aria2cFolder + "\\mergeFile.txt", aria2cFolder + '\\output.mp4');

  // TODO: delete the temp files and folders here
  console.log(`aria2c download of ${outputMp4} took ${Math.round((Date.now() - start) / 1000)} seconds.`)
}

//downloadWAria2c()

