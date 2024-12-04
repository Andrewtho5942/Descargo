(function () {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        console.log('args:')
        console.log(args)
      if (args[0].endsWith('.m3u8')) {
        console.log('M3U8 file detected via Fetch:', args[0]);
        // Store or process the URL here.
      }
      return originalFetch.apply(this, args);
    };
  
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (url.endsWith('.m3u8')) {
        console.log('M3U8 file detected via XHR:', url);
        // Store or process the URL here.
      }
      return originalXhrOpen.apply(this, [method, url, ...rest]);
    };
  })();