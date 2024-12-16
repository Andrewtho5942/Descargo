settings = [
  { key: "AHKPath", value: 'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey.exe' },
  { key: "focusExplorerPath", value: 'C:\\Users\\andre\\focusExplorer.ahk' },
  { key: "darkMode", value: true },
  { key: "cloudMode", value: false},

  { key: "m3u8Notifs", value: true },
  { key: "mp4Notifs", value: true },
  { key: "m4aNotifs", value: false },
  { key: "failureNotifs", value: false },
  { key: "playlistNotifs", value: false },

  { key: "outputPath", value: 'C:\\Users\\andre\\Downloads\\Descargo' },
  { key: "removeSubtext", value: true },
  { key: "normalizeAudio", value: true },
  { key: "playlistLink", value: '' },
  { key: "useShazam", value: false },
  { key: "gdriveJSONKey", value: 'C:\\Users\\andre\\OneDrive\\Documents\\Webdev\\descargo\\server\\keys\\yt-dl-443015-d39da117fe4a.json' },
  { key: "gdriveFolderID", value: '17pMCBUQxJfEYgVvNwKQUcS8n4oRGIE9q' },
  { key: "downloadm3u8", value: false },

  { key: "submitHotkey", value: 'Enter' },
  { key: "formatHotkey", value: 'p' },
  { key: "gdriveHotkey", value: 'g' },
  { key: "getMenuHotkey", value: 'n' },
  { key: "historyMenuHotkey", value: 'm' },
  { key: "openClearHotkey", value: 'o' },
  { key: "backHotkey", value: 'Backspace' },
  { key: "autofillHotkey", value: 'f' },
  { key: "settingsHotkey", value: 's' },
]

let storage = browser.storage.local;
let inputElements = [];


function setInputValues() {
  for (let i = 0; i < inputElements.length; i++) {
    let input = inputElements[i];
    if (input.classList.contains('switch-checkbox')) {
      input.checked = settings[i].value;

      if (settings[i].key === 'darkMode') {
        document.documentElement.setAttribute('data-theme', settings[i].value ? 'dark' : 'light')
      }
    } else if (input.classList.contains('text-input')) {
      console.log('loading from storage:')
      console.log(settings[i].value)
      input.value = settings[i].value;
    }
  }

  console.log('updated input value displays');
}

function setHotkeyLabels() {
  const hotkeyLabels = document.getElementsByClassName('hotkey-text');
  const firstHotkeySetting = settings.length - hotkeyLabels.length;

  //iterate over the hotkey settings
  for (let i = firstHotkeySetting; i < settings.length; i++) {
    //set the current hotkey setting to the label value
    hotkeyLabels[i - firstHotkeySetting].textContent = settings[i].value;
    console.log('labeled hotkey ' + settings[i].key + ' as ' + settings[i].value);
  }
}

function updateFromStorage() {
  storage.get("settings", function (result) {
    if (result.settings && result.settings.length === settings.length) {
      settings = result.settings;
      console.log('Pulled settings from storage: ', settings);
    } else {
      console.log('settings has incorrect length! storing the default values...');
      storage.set({ ['settings']: settings });
    }

    setInputValues();
    setHotkeyLabels();
  });
}



document.addEventListener('DOMContentLoaded', () => {
  inputElements = document.getElementsByTagName('input')
  console.log('input elements: ')
  console.log(inputElements)

  updateFromStorage();


  const hotkeyListeners = new Map();

  // add the listeners for each input 
  for (let i = 0; i < inputElements.length; i++) {

    let input = inputElements[i];
    let classes = input.classList;

    if (classes.contains('switch-checkbox')) {
      input.addEventListener('click', () => {
        //store the new setting change
        console.log('new value for settings field ' + settings[i].key + ': ' + input.checked);
        settings[i].value = input.checked;
        storage.set({ ['settings']: settings });

        if (settings[i].key === 'darkMode') {
          document.documentElement.setAttribute('data-theme', settings[i].value ? 'dark' : 'light')
        }
      });


    } else if (classes.contains('hotkey')) {


      const handleKeyDown = (e) => handleKeyPress(e, i);


      function handleKeyPress(event, i) {
        event.preventDefault();
        const key = event.key;
        console.log('remapping hotkey ' + settings[i].key + ' from ' + settings[i].value + ' to: ' + key);

        if (!settings.find(s => (s.value === key) && (s.key !== settings[i].key))) {
          //set the setting value and store it
          settings[i].value = key;
          storage.set({ ['settings']: settings });
          // show the change on screen
          setHotkeyLabels();
        } else {
          console.log('detected duplicate key bindings! Hotkey not changed.');



          //set the hotkey-text background to red for 0.5 secs...

          const hotkeyLabels = document.getElementsByClassName('hotkey-text');
          const firstHotkeySetting = settings.length - hotkeyLabels.length;
          const hotKeyLabel = hotkeyLabels[i - firstHotkeySetting];
          hotKeyLabel.style.backgroundColor = 'red';
          setTimeout(() => {
            hotKeyLabel.style.backgroundColor = '';
          }, 500);
        }

        console.log('removing the keydown listener...')
        inputElements[i].checked = false;

        const listener = hotkeyListeners.get(i);
        if (listener) {
          window.removeEventListener('keydown', listener);
          hotkeyListeners.delete(i);
        }
      };


      function resetHotkeys(i) {
        console.log('resetting hotkeys')

        Array.from(inputElements).forEach((input, index) => {
          if ((input.classList.contains('hotkey')) && (index !== i)) {
            input.checked = false;
            const listener = hotkeyListeners.get(index);
            if (listener) {
              console.log('removing keydown listener for hotkey ' + index + '...');
              window.removeEventListener('keydown', listener);
              hotkeyListeners.delete(index);
            }
          }
        })
      }

      console.log('listening for key press to reassign ' + settings[i].key + '...')

      input.addEventListener('click', () => {
        if (input.checked) {
          //reset all other hotkeys 
          resetHotkeys(i);
          hotkeyListeners.set(i, handleKeyDown);
          window.addEventListener('keydown', handleKeyDown);
        } else {
          const listener = hotkeyListeners.get(i);
          if (listener) {
            window.removeEventListener('keydown', listener);
            hotkeyListeners.delete(i);
          }
        }
      });
    } else if (classes.contains('text-input')) {
      console.log('adding onchange listener...')
      input.addEventListener('input', (event) => {
        const newValue = event.target.value;
        settings[i].value = newValue;

        storage.set({ ['settings']: settings });
        console.log(`Saved new value for ` + settings[i].key + `: ${newValue}`);
      });
    }

  }

  // add submit listeners for playlist-input
  const playlistForm = document.getElementById('playlist-form');
  const playlistInput = document.getElementById('playlist-input');
  const playlistBtn = document.getElementById('playlist-btn');

  function handleStartPlaylist(event) {
    event.preventDefault();


    console.log('starting playlist download: ' + playlistInput.value);


    playlistInput.value = '';
    settings.find(s => s.key === 'playlistLink').value = '';
    storage.set({ ['settings']: settings });

  }

  if (playlistForm) {
    playlistForm.addEventListener('submit', handleStartPlaylist)
  }
  if (playlistBtn) {
    playlistBtn.addEventListener('click', handleStartPlaylist)
  }
});



