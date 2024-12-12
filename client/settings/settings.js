settings = [
  { key: "m3u8Notifs", value: true },
  { key: "m4aNotifs", value: false },
  { key: "mp4Notifs", value: false },
  { key: "AHKPath", value: '' },
  { key: "darkMode", value: true },

  { key: "downloadsPath", value: '' },
  { key: "useShazam", value: false },
  { key: "removeSubtext", value: true },
  { key: "normalizeAudio", value: true },
  { key: "playlistLink", value: '' },

  { key: "gdriveHotkey", value: 'g' },
  { key: "formatHotkey", value: 'p' },
  { key: "getMenuHotkey", value: 'n' },
  { key: "historyMenuHotkey", value: 'm' },
  { key: "openClearHotkey", value: 'o' },
  { key: "backHotkey", value: 'Backspace' },
  { key: "autofillHotkey", value: 'f' }
]

let storage = browser.storage.local;
let inputElements = [];

function updateFromStorage() {
  storage.get("settings", function (result) {
    if (result.settings && result.settings.length === settings.length) {
      settings = result.settings;
      console.log('Pulled settings from storage: ', settings);
    } else {
      console.log('settings has incorrect length! storing the default values...');
      storage.set({ ['settings']: settings });
    }

    setInputValues()
  });
}

function setInputValues() {
  for (let i = 0; i < inputElements.length; i++) {
    let input = inputElements[i];
    if (input.type === 'checkbox') {
      input.checked = settings[i].value;
    }
  }


  console.log('updated input value displays');
}





document.addEventListener('DOMContentLoaded', () => {
  inputElements = document.getElementsByTagName('input')
  console.log('input elements: ')
  console.log(inputElements)

  updateFromStorage();


  // add the listeners for each input 
  for (let i = 0; i < inputElements.length; i++) {
    let input = inputElements[i];
    if (input.type === 'checkbox') {
      input.addEventListener('click', () => {
        //store the new setting change
        console.log('new value for input ' + i + ': ' + input.checked);
        settings[i].value = input.checked;
        storage.set({ ['settings']: settings });

      });

    }
  }


  // saveButton.addEventListener('click', () => {
  //   const setting1Value = document.getElementById('setting1').value;
  //   const setting2Value = document.getElementById('setting2').checked;

  //   // Display a status message
  //   statusParagraph.textContent = `Settings saved: 
  //       Setting 1 = ${setting1Value}, 
  //       Setting 2 = ${setting2Value ? 'Enabled' : 'Disabled'}`;
  // });
});



