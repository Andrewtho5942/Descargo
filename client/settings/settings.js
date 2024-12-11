document.addEventListener('DOMContentLoaded', () => {
    const saveButton = document.getElementById('save');
    const statusParagraph = document.getElementById('status');
    
    saveButton.addEventListener('click', () => {
      const setting1Value = document.getElementById('setting1').value;
      const setting2Value = document.getElementById('setting2').checked;
  
      // Display a status message
      statusParagraph.textContent = `Settings saved: 
        Setting 1 = ${setting1Value}, 
        Setting 2 = ${setting2Value ? 'Enabled' : 'Disabled'}`;
    });
  });