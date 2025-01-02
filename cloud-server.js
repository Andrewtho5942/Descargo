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
const archiver = require('archiver');

const execAsync = util.promisify(exec);


const app = express();
const PORT = 3000;

// middleware
app.use(cors());
app.use(bodyParser.json());


process.env.LANG = 'en_US.UTF-8';


// global variables

let max_concurrent_downloads = 10;
let num_downloads = 0;
let abortAllPlaylists = false;
let killOverride = false;



let downloadsPath = "/home/andrewtho5942/descargo-server/downloads";
let tempFolderPath = "/home/andrewtho5942/descargo-server/temp";


let activeProcesses = {};


let clients = [];



// send a message to every client
function broadcastProgress(message) {
  clients.forEach(client => client.write(`data: ${JSON.stringify(message)}\n\n`));
}


app.get('/', (req, res) => {
  console.log('connection detected');
  res.send('Hello from andrew-laptop!');
})



// endpoint to connect to client and send data back to it
app.get('/progress', (req, res) => {
  console.log('received progress connection');

  // set headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  // Force chunked encoding / flush
  if (res.flushHeaders) {
    res.flushHeaders();
  }


  // send a comment to keep the connection alive and add client
  res.write(`data: ${JSON.stringify({ message: 'connected' })}\n\n`);

  if (res.flush) {
    res.flush();
  }

  clients.push(res);


  // send messages on interval to not close the SSE connection
 const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);


  // remove the client when the connection is closed
  req.on('close', () => {
    clearInterval(keepAlive);
    clients = clients.filter(client => client !== res);
  });
});





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

    const process = spawn('python3', [
      '-u', '-m', 'whisper',
      `"${videoPath}"`,
      '--language', 'en',
      '--model', 'small',
      '--device', 'cuda',
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
// confidence threshold:(for small model) 0.8 - too low
function generateSubtitles(videoPath, outputPath, file, timestamp, fileName, confidenceThreshold = 0.95, maxDuration = 8) {
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
        deleteFileIfExists(srtPath);
        return resolve();
      });
    }).catch((e) => {
      const msg = 'ERROR generating subtitles: ' + e.message
      console.log(msg);
      return reject(msg);
    });
  });
}








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




const processVideoTitle = (title, removeSubtext) => {
  if (removeSubtext) {
    title = title.replace(/(\[.*?\]|\(.*?\))/g, '') // optionally remove any text in brackets or parenthesis
  }

  return title.replace(/[^a-zA-Z0-9\-',$'.()[\]%#@!^{}+=&~; ]/g, '_') // replace special characters with underscores
    .replace(/\s+/g, ' ') // replace multiple spaces with a space
    .trim(); //remove trailing and leading whitespace
};



// forcefully deletes an entire folder, use with caution
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




// Change keypath to use actual file
function createGdriveAuth(gdriveFolderID, keyPath, timestamp) {
  //write the key content to a file and use it to create the key
  const tempKeyPath = tempFolderPath + `/${Date.parse(timestamp)}_gdrivekey.json`;
  fs.writeFileSync(tempKeyPath, keyPath);
  const key = require(tempKeyPath);

  console.log('creating auth');
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  console.log('done')
  deleteFileIfExists(tempKeyPath);
  return google.drive({ version: 'v3', auth });
}


async function ensureGdriveFolderExists(gdriveFolderID, playlistName, drive) {
  // Check if playlist folder exists
  const folderQuery = `name='${playlistName}' and mimeType='application/vnd.google-apps.folder' and '${gdriveFolderID}' in parents and trashed=false`;
  const folderResponse = await drive.files.list({
    q: folderQuery,
    fields: 'files(id, name)'
  });

  let playlistFolderID;
  console.log('folderResponse: ', folderResponse)

  if (folderResponse.data.files.length > 0) {
    // Folder exists, get its ID
    playlistFolderID = folderResponse.data.files[0].id;
    console.log(`Playlist folder '${playlistName}' already exists with ID: ${playlistFolderID}`);
  } else {
    // Folder does not exist, create it
    const createFolderResponse = await drive.files.create({
      resource: {
        name: playlistName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [gdriveFolderID]
      },
      fields: 'id'
    });

    playlistFolderID = createFolderResponse.data.id;
    console.log(`Created playlist folder '${playlistName}' with ID: ${playlistFolderID}`);
  }

  return playlistFolderID;
}



async function ensureDirectoryExists(dirPath) {
  try {
    await fs_promises.mkdir(dirPath, { recursive: true });
    console.log(`Directory ensured: ${dirPath}`);
  } catch (err) {
    console.error(`Error creating directory: ${err.message}`);
  }
}





function updatePaths() {
  //downloadsPath = outputPath + '/downloads';
  //tempFolderPath = outputPath + "/temp"

  // make sure these folders exist
  ensureDirectoryExists(downloadsPath);
  ensureDirectoryExists(tempFolderPath);
}




// function to upload a file to Google Drive
async function uploadFile(filePath, fileName, drive, gdriveFolderID, playlistName) {
  return new Promise(async (resolve, reject) => {
    try {
      if (playlistName) {
        let playlistFolderID = await ensureGdriveFolderExists(gdriveFolderID, playlistName, drive);

        // Upload the file to the playlist folder
        await drive.files.create({
          resource: {
            name: fileName,
            parents: [playlistFolderID]
          },
          media: {
            mimeType: 'application/octet-stream',
            body: fs.createReadStream(filePath)
          },
          fields: 'id'
        });
        console.log(`File '${fileName}' uploaded successfully to playlist folder '${playlistName}'!`);

      } else {
        // Upload the file to the google drive base folder if playlistName is empty
        await drive.files.create({
          resource: {
            name: fileName,
            parents: [gdriveFolderID]
          },
          media: {
            mimeType: 'application/octet-stream',
            body: fs.createReadStream(filePath)
          },
          fields: 'id'
        });
        console.log(`File '${fileName}' uploaded successfully to the downloads folder!`);
      }

      resolve();
    } catch (error) {
      console.error('Error uploading file:', error);
      reject(error);
    }
  });
}





// Function to delete files that match a given prefix
function clearCache(fileName, timestamp) {
  try {
    const timestamp_date = Date.parse(timestamp)

    // Read all files in the directory
    fs.readdir(tempFolderPath, (err, files) => {
      if (err) {
        console.error(`Error reading directory ${directory}:`, err);
        return;
      }

      // Filter files that start with the given prefix
      const matchingFiles = files.filter(file => (file.startsWith(fileName)) || (file.startsWith(timestamp) || (file.startsWith(timestamp_date))));
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






function processFFMPEGLine(fileName, url, lines, totalDuration, timestamp, taskMsg) {
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const [key, value] = line.split('=');
    if (key && value) {
      if (key.trim() === 'out_time_ms') {
        const currentTime = parseInt(value.trim(), 10) / 1000000;
        const progressPercentage = (currentTime / totalDuration) * 100;

        if (progressPercentage && (progressPercentage >= 0)) {
          console.log(`ffmpeg progress: ${progressPercentage.toFixed(2)}%`);

          const message = { progress: progressPercentage.toFixed(2), status: 'in-progress', file: url, timestamp: timestamp, fileName: fileName, task: taskMsg };
          broadcastProgress(message)
        }
      }
    }
  }
}






function findPermPath(desiredFileName, format, playlistFolder) {
  let permPath = ''
  if(playlistFolder){
    permPath = `${downloadsPath}/${playlistFolder}/${desiredFileName}`;
  }else{
    permPath = `${downloadsPath}/${desiredFileName}`;
  }
  index = 0;

  let desiredName = desiredFileName.slice(0, desiredFileName.lastIndexOf('.'))
  console.log('desiredName: ' + desiredName)

  // increment the permpath index until it finds a name that isnt already taken
  while (fs.existsSync(permPath)) {
    index++;

    if (playlistFolder) {
      permPath = `${downloadsPath}/${playlistFolder}/${desiredName}_${index}.${format}`;
    } else {
      permPath = `${downloadsPath}/${desiredName}_${index}.${format}`
    }
  }
  return permPath;
}






function streamVideo(permPath, res, newFile) {
  return new Promise((resolve, reject) => {
    console.log('Creating read stream');

    const fileStream = fs.createReadStream(permPath);

    // Set response headers
    res.setHeader('Content-Disposition', `attachment; filename="${newFile.value}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(permPath).size);

    // Listen for chunks of data
    fileStream.on('data', (chunk) => {
      console.log(`Sending chunk of size: ${chunk.length}`);
      res.write(chunk);
      if (res.flush) {
        res.flush(); // Force sending the buffer
      }
    });

    fileStream.on('end', () => {
      console.log('Stream ended successfully');
      res.end(); // End the response explicitly
      resolve();
    });

    fileStream.on('error', (err) => {
      console.error('Error streaming file:', err);
      res.status(500).send('Error downloading the file.');
      reject(err);
    });

    res.on('close', () => {
      console.log('Response closed prematurely');
      reject(new Error('Connection closed before file finished'));
    });
  });
}




async function finishUpload(generateSubs, format, gdrive, resolve, filePath, newFile, gdriveFolderID,
  gdriveKeyPath, url, timestamp, start, res, playlistFolder, playlistName) {

  try {
    let permPath = findPermPath(newFile.value, format, playlistFolder);
    console.log('permPath: ' + permPath);

    //move the file from temp to downloads OR generate the subtitles and write the mp4 with subititles to the permPath
    if (generateSubs && (format === 'mp4')) {

      broadcastProgress({ progress: 0, status: 'in-progress', file: url, timestamp: timestamp, fileName: newFile.value, task: 'Transcribing...' })
      await generateSubtitles(filePath, permPath, url, timestamp, newFile.value);
      // upload the file with captions to google drive
      if (gdrive) {
        const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath, timestamp);

        console.log('Uploading to gdrive', newFile.value);
        await uploadFile(permPath, newFile.value, drive, gdriveFolderID, playlistName);
      }
    } else {
      // upload to google drive if necessary
      if (gdrive) {
        const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath, timestamp);

        console.log('Uploading to gdrive', newFile.value);
        await uploadFile(filePath, newFile.value, drive, gdriveFolderID, playlistName);
      }

      deleteFileIfExists(permPath);
      fs.moveSync(filePath, permPath);
    }

    if(!playlistFolder) {
      broadcastProgress({ progress: 100, status: 'in-progress', file: url, timestamp: timestamp, fileName: newFile.value, task: 'Streaming...' })
      await streamVideo(permPath, res, newFile);
    }

    clearCache(newFile.value, timestamp);
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
    broadcastProgress({ progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile.value, error:e.message });
    delete activeProcesses[timestamp];
    resolve({ message: 'failure', file: url, timestamp: timestamp, fileName: newFile.value });
  }
}





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
            console.log('### killOverride: '+killOverride)
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





function ytdlpDownload(bodyObject, res, playlistFolder, playlistName) {
  let start = Date.now()
  num_downloads++;

  return new Promise((resolve, reject) => {
    ytdlpMain(bodyObject, res);

    // wrap the main process in another function to enable retries on error
    function ytdlpMain(bodyObjectInner, res) {
      console.log('ytdlpMain arguments:');
      console.log(bodyObjectInner);

      let { url, format, gdrive, timestamp, outputPath, gdriveKeyPath, gdriveFolderID, removeSubtext,
        normalizeAudio, compressFiles, useShazam, cookiePath, maxDownloads, generateSubs, m3u8Title, useAria2c } = bodyObjectInner;

      if (playlistFolder) {
        ensureDirectoryExists(downloadsPath + '/' + playlistFolder);
      }

      max_concurrent_downloads = maxDownloads || 10;
      console.log('updated max_concurrent downloads to ' + max_concurrent_downloads)

      updatePaths();


      // Uniquely name the temp file using the timestamp
      let timestamp_date = Date.parse(timestamp)
      let tempFile = timestamp_date + '.' + format;
      let tempFilePath = tempFolderPath + '/' + tempFile;
      console.log('temp file: ' + tempFile);


      // Construct yt-dlp command arguments
      let args = [`"${url}"`, '-o', `"${tempFilePath}"`];

      // if using cookies, then write the cookies to a temporary text file and store the path to this in cookiePath
      if (cookiePath) {
        const cookieFilePath = tempFolderPath + `/${timestamp_date}_cookies.txt`;
        fs.writeFileSync(cookieFilePath, cookiePath.trim(), 'utf8');
        cookiePath = cookieFilePath

        args.push('--cookies', `"${cookiePath.replace(/\\/g, '/')}"`);
     }

      // use ytdlp to download the video concurrently 8 segments at a time
      if (useAria2c) {
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

          console.log('### killOverride at close: '+killOverride)

          //retry the yt-dlp process but without cookies
          if (cookiePath && !killOverride) {
            console.log('Retrying without cookies...');
            ytdlpMain({ ...bodyObject, cookiePath: '' }, res);
            return;
          }

          const message = { progress: 0, status: 'error', file: url, timestamp: timestamp, fileName: newFile.value, error:'error in ytdlp' };
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
          broadcastProgress({ progress: 100, status: 'in-progress', file: url, timestamp: timestamp, fileName: 'fetching... ', task: 'Renaming...' })
          await titlePromise;
          console.log(' ------------- cleaned title: ' + newFile.value)
        }

        let filePath = tempFolderPath + '/' + newFile.value;


        // start the shazam call
        let shazamPromise = null;
        if (useShazam) {
          shazamPromise = getTitlewShazam(tempFilePath, url, cookiePath, newFile, removeSubtext, format, m3u8Title);
        }
//optionally normalize the audio
        if (normalizeAudio || compressFiles) {
          const totalDuration = await getTotalDuration(tempFilePath);
          deleteFileIfExists(filePath);

          //normalize the audio and save it to the new path (renaming it)
          let ffmpegArgs = [
            '-i', tempFilePath,
            '-c:a', 'aac',  // re-encode audio to aac
          ]

          if (normalizeAudio) {
            ffmpegArgs.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11')
          }

          if (compressFiles) {
            ffmpegArgs.push('-b:a', '96k', // audio bitrate, 128k is about no effect (depending on source audio)
              '-c:v', 'libx264',  // H265 provides better compression than H264 but less widely compatible
              '-crf', '33',       // constant rate factor: controls quality (28 is about same as no effect), increase -> smaller, decrease -> larger
            )
          } else {
            if(!normalizeAudio)  ffmpegArgs.push('-c:a', 'copy');
            ffmpegArgs.push('-c:v', 'copy')
          }

          ffmpegArgs.push(filePath,
            '-threads', `${os.cpus().length - 1}`,
            '-progress', 'pipe:1',
            '-nostats')

          console.log('ffmpeg command args: ', ffmpegArgs);

          const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

          activeProcesses[timestamp] = { process: ffmpegProcess, fileName: newFile.value }

          let progressData = '';

          ffmpegProcess.stdout.on('data', (chunk) => {
            progressData += chunk.toString();

            // iterate over data's lines
            const lines = progressData.split('\n');
            let taskMsg = compressFiles ? 'Compressing...' : 'Normalizing...';
            processFFMPEGLine(newFile.value, url, lines, totalDuration, timestamp, taskMsg);
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
              const errorMessage = { progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile.value, error: 'error in ffmpeg' };
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
                  const errorMessage = { progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile.value, error: 'error renaming file' };
                  broadcastProgress(errorMessage);
                  resolve(errorMessage);
                  return;
                }

                filePath = newShazamPath;
              }

              finishUpload(generateSubs, format, gdrive, resolve, filePath, newFile, gdriveFolderID, gdriveKeyPath, url, timestamp, start, res, playlistFolder, playlistName);

              return;
            }
          });

        } else {
          // rename the file with shazam API from gettitlewshazam or rename it with ytdlp
          try {
            if (useShazam && shazamPromise) {
              broadcastProgress({ progress: 100, status: 'in-progress', file: url, timestamp: timestamp, fileName: 'fetching... ', task: 'Renaming...' })
              await shazamPromise;
              console.log('got title with shazam: ' + newFile.value);
              let newShazamPath = tempFolderPath + '/' + newFile.value;

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
            const errorMessage = { progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile.value, error:'error renaming file' };
            broadcastProgress(errorMessage);
            resolve(errorMessage);
            return;
          }

          finishUpload(generateSubs, format, gdrive, resolve, filePath, newFile, gdriveFolderID, gdriveKeyPath,
            url, timestamp, start, res, playlistFolder, playlistName);

          return;
        }
      });

      ytDlpProcess.on('error', (error) => {
        console.error(`Error executing yt-dlp: ${error.message}`);
        broadcastProgress({ progress: 0, timestamp: timestamp, file: url, status: 'error', fileName: newFile.value, error:'error executing ytdlp' });
        delete activeProcesses[timestamp];
        resolve({ message: 'failure', timestamp: timestamp });
        return;
      });

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
      console.log('set killOverride to true');

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

              process.on('close', () =>{
                setTimeout(() => {
                  resolve();
                }, 200)
              })
              res.send({ message: 'Success: Download stopped' });
              return;
            });
          });
        }

        await killProcess();
        console.log('killed process, setting killOverride to false')
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
  try{
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
            process.on('close', () =>{
              setTimeout(() => {
                resolve();
              }, 200)
            })
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
    deleteFolderIfExists(tempFolderPath)
    deleteFolderIfExists(downloadsFolderPath)

    res.send({ message: 'Success: All processes stopped' });
  } catch (err) {
    console.error('One or more processes failed to stop:', err);
    res.send({ message: 'Error stopping some processes', error: err.message });
  }
} catch(e){
  console.log('ERROR in /kill_processes: ', e)
}
});






// endpoint to handle download requests
app.post('/download', async (req, res) => {
  try{
  console.log('got download request')
  //res.send({message:'success'})
  let response = await ytdlpDownload(req.body, res, '', '').finally(() => { num_downloads-- });
  if(response.message !== 'success') {
    res.send(response);
  }
}catch(e) {
  console.log('ERROR in /download: ', e)
}
});





function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function streamZipPlaylist(res, playlistFolder) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', {
      zlib: { level: 9 }, // Compression level
    });

    archive.on('error', (err) => {
      console.error('Error creating archive:', err);
      reject(err);
    });

    // Resolve the promise when the response stream finishes
    res.on('finish', resolve);

    archive.pipe(res);


    let playlistPath = downloadsPath + '/' + playlistFolder

    console.log('playlist path: '+playlistPath)

    fs.readdir(playlistPath, (err, files) => {
      files.forEach((file) => {
        console.log('playlist file name: '+file)
        let filePath = playlistPath + '/' + file
        archive.file(filePath, { name: file });
      })

    archive.finalize();
  });
})
}


//endpoint to handle playlist requests
app.post('/playlist', (req, res) => {
  try{
  abortAllPlaylists = false;
  let playlistFolder = Date.now();


  const { playlistURL, format, gdrive, outputPath, gdriveKeyPath, gdriveFolderID, removeSubtext,
    normalizeAudio, compressFiles, useShazam, cookiePath, maxDownloads, generateSubs, m3u8Title, useAria2c } = req.body;
  console.log('received playlist request!');

  let command = `yt-dlp --flat-playlist -j "${playlistURL}"`
  let cookieFilePath = '';

  if (cookiePath) {
    ensureDirectoryExists(tempFolderPath);
    cookieFilePath = tempFolderPath + `/${playlistFolder}_cookies.txt`;
    fs.writeFileSync(cookieFilePath, cookiePath.trim(), 'utf8');

    command += ` --cookies "${cookieFilePath.replace(/\\/g, '/')}"`
  }

  exec(command, async (error, stdout, stderr) => {
    if (error) {
      const message = 'ERR in flatten playlist - ' + error.message;
      console.log(message);
      res.send({ message: 'failure' });
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
        normalizeAudio, compressFiles, useShazam, cookiePath, maxDownloads, generateSubs, m3u8Title, useAria2c
      };

      const dlPromise = ytdlpDownload(bodyObject, res, playlistFolder, playlistName).finally(() => { num_downloads-- });
      downloadPromises.push(dlPromise);

      // wait for a quarter a second to not overload the server
      await delay(250);
    }

    // create the google drive folder if using gdrive
    if (gdrive) {
      ensureGdriveFolderExists(gdriveFolderID, playlistName, createGdriveAuth(gdriveFolderID, gdriveKeyPath));
    }



    await Promise.all(downloadPromises);
    if (cookieFilePath) {
      deleteFileIfExists(cookieFilePath);
    }

    // downloads are finished
    console.log('All downloads are completed! Zipping files and streaming them...')

    res.setHeader('Content-Disposition', `attachment; filename="${playlistName}.zip"`);
    res.setHeader('Content-Type', 'application/zip');

    try {
      await streamZipPlaylist(res, playlistFolder);

      console.log('Archiving complete! Sending broadcast to client... ');

      const message = { status: 'playlist-completed', playlistName: playlistName };
      broadcastProgress(message)

    } catch (err) {
      console.error('Error during archiving:', err);
      res.send({message: 'failure'});
     }
    });
  }catch(e){
    console.log('ERROR in /playlist: ', e)
  }
});







// clear a folder
app.post('/clear', (req, res) => {
  try{
  const { type, outputPath, gdriveKeyPath, gdriveFolderID } = req.body;
  updatePaths();
  const timestamp = new Date().toISOString();

  if (type === 'gdrive-downloads') {
    const drive = createGdriveAuth(gdriveFolderID, gdriveKeyPath, timestamp);
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
  }catch(e) {
    console.log('ERROR in /clear_folder: ', e);
  }
});




// start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});




// catch all endpoint to debug missing endpoints
app.use((req, res) => {
    console.log(`404 - Not Found: ${req.url}`);
    res.status(404).send('Not Found');
});
