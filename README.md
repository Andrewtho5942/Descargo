# YT-Downloader
- This project is a firefox browser extension that enables you to download videos from any hosting platform on the internet, either with a link,
or by detecting .m3u8 files as they are loaded by the page and converting them to mp4.
- The extension uses a server running locally to do file manipulation currently, including ffmpeg for .m3u8 file conversion and yt-dlp for downloading and processing youtube videos.
- Here are a few interesting features that the extension offers:
  - upload directly to google drive from within the extension
  - toggle downloading m4a (audio) and mp4 (video)
  - clear local downloads folder and google drive downloads folder
  - open google drive and local folder
  - notifications for when .m3u8 files are done downloading
  - automatic detection of .m3u8 files when loading web pages
  - history page containing receently downloaded files and in-progress files with live progress bars
  - persistent storage of m3u8 links and history
  - autofill the current tab's link for downloading videos with yt-dlp, and type ytsearch:<query> to search youtube for a video
  - automatically clean up the youtube video title for downloading yt-dlp videos

Currently, to install this on your system, you will need to set up your own node server, autohotkey script, yt-dlp.conf file, and install the extension with the provided .xpi file. It will only work with windows and firefox. In the future, I would like to
make this more widely compatible and easier to install on other systems.
