
//const ISLOCAL = true;
//const SERVER_PORT = 5001;
// const serverURL = ISLOCAL ? `http://localhost:${SERVER_PORT}` : "https://3a51-156-146-107-197.ngrok-free.app";

let settings = [
  { key: "darkMode", value: true },
  { key: "cloudMode", value: false },
  { key: "highlightColor", value: '' },
  { key: "AHKPath", value: 'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey.exe' },
  { key: "focusExplorerPath", value: 'C:\\Users\\andre\\focusExplorer.ahk' },


  { key: "m3u8Notifs", value: true },
  { key: "mp4Notifs", value: false },
  { key: "m4aNotifs", value: false },
  { key: "failureNotifs", value: false },
  { key: "playlistNotifs", value: true },

  { key: "outputPath", value: 'C:\\Users\\andre\\Downloads\\Descargo' },
  { key: "removeSubtext", value: true },
  { key: "normalizeAudio", value: false },
  { key: "compressFiles", value: false },
  { key: "useShazam", value: false },
  { key: "generateSubs", value: false },
  { key: "useAria2c", value: true },
  { key: "maxDownloads", value: '10' },

  { key: "gdriveJSONKey", value: 'C:\\Users\\andre\\OneDrive\\Documents\\Webdev\\descargo\\server\\keys\\yt-dl-443015-d39da117fe4a.json' },
  { key: "gdriveFolderID", value: '17pMCBUQxJfEYgVvNwKQUcS8n4oRGIE9q' },
  { key: "cookiePath", value: "C:\\Users\\andre\\OneDrive\\Documents\\cookies.firefox-private.txt" },
  { key: "gdriveKeyText", value: "" },
  { key: "cookieText", value: "" },

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

const onlyCloudSettings = ["gdriveKeyText", "cookieText"];
const onlyLocalSettings = ["AHKPath", "focusExplorerPath", "outputPath", "gdriveJSONKey", "cookiePath"];

let storage = browser.storage.local;
let inputElements = [];



function setInputValues() {
  let cloudMode = settings.find(s => s.key === "cloudMode").value;

  console.log('cloudMode: ' + cloudMode)

  for (let i = 0; i < inputElements.length; i++) {
    let input = inputElements[i];

    if (input.classList.contains('switch-checkbox')) {
      input.checked = settings[i].value;

      // initialize the theme based on the state of the darkMode slider
      if (settings[i].key === 'darkMode') {
        document.documentElement.setAttribute('data-theme', settings[i].value ? 'dark' : 'light')
      }
    } else if (input.classList.contains('text-input')) {
      //console.log('loading from storage:')
      //console.log(settings[i].value)
      input.value = settings[i].value;

      // initialize the theme based on the state of the highlightColor textbox
      if (settings[i].key === 'highlightColor') {
        let highlightColor = settings[i].value;
        console.log('highlightColor: ' + highlightColor);
        document.documentElement.setAttribute('data-highlight', ['orange', 'purple', 'blue'].includes(highlightColor) ? highlightColor : 'green')
      }
    }

    // update the visibility of settings depending on the cloudMode value
    if (cloudMode) {
      if (onlyCloudSettings.includes(settings[i].key)) {
        //console.log('setting cloud mode element ' + settings[i].key + ' to visible')
        input.parentElement.style.display = 'flex';
      } else if (onlyLocalSettings.includes(settings[i].key)) {
        //console.log('setting cloud mode element ' + settings[i].key + ' to hidden')
        input.parentElement.style.display = 'none';
      }
    } else {
      if (onlyCloudSettings.includes(settings[i].key)) {
        //console.log('setting local mode element ' + settings[i].key + ' to hidden')
        input.parentElement.style.display = 'none';
      } else if (onlyLocalSettings.includes(settings[i].key)) {
        //console.log('setting local mode element ' + settings[i].key + ' to visible')
        input.parentElement.style.display = 'flex';
      }
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
    //console.log('labeled hotkey ' + settings[i].key + ' as ' + settings[i].value);
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
    storage.set({ ['cloudMode']: settings.find(s => s.key === 'cloudMode').value })

    setInputValues();
    setHotkeyLabels();
  });
}



document.addEventListener('DOMContentLoaded', () => {
  inputElements = document.querySelectorAll('input, textarea');
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
        } else if (settings[i].key === 'cloudMode') {
          storage.set({ ['cloudMode']: settings[i].value })
          setInputValues();
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

      //console.log('listening for key press to reassign ' + settings[i].key + '...')

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
        let newValue = event.target.value;

        if (settings[i].key === 'maxDownloads') {
          try {
            newValue = parseInt(newValue);

            if (!newValue) {
              console.log('no new value: ' + newValue)
              newValue = 1;
              input.value = '';
            } else {
              console.log('newvalue: ' + newValue)
              newValue = Math.min(Math.max(newValue, 1), 25); // range must be between 1 - 25
              settings[i].value = newValue;

              input.value = settings[i].value;
            }
          } catch (e) {
            console.log('new maxDownloads value (' + newValue + ') is not a number! Error: ' + e.message) //dont update if it cannot be parsed into a number           
          }
        } else {
          settings[i].value = newValue;
        }
        if (settings[i].key === 'highlightColor') {
          // initialize the theme based on the state of the highlightColor textbox
          let highlightColor = settings[i].value;
          document.documentElement.setAttribute('data-highlight', ['orange', 'purple', 'blue'].includes(highlightColor) ? highlightColor : 'green')
        }
        storage.set({ ['settings']: settings });
        console.log(`Saved new value for ` + settings[i].key + `: ${newValue}`);
      });
    }
  }



  // add onclick listeners for the highlight choices
  let highlightChoices = document.getElementsByClassName('highlight-choice');
  let highlightInput = document.getElementById('highlight-input');


  for (let choiceNum = 0; choiceNum < highlightChoices.length; choiceNum++) {
    let choice = highlightChoices[choiceNum];
    choice.addEventListener('click', () => {
      // when the element is clicked, set the text in the choice to the input
      highlightInput.value = choice.innerHTML;

      // dispatch a new input event to trigger the listener
      highlightInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
});



