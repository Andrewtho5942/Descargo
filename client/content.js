(function () {
    const injectButton = () => {
        console.log('injecting button to yt page...');

        const menuContainer = document.querySelector('#top-row #owner');
        if (!menuContainer || document.querySelector('#custom-download-button')) return;

        const style = document.createElement('style');
        style.textContent = `
            #custom-download-button {
                margin-left: 10px;
                background-color: rgb(8, 79, 40);
                color: #fff;
                border: none;
                padding: 8px 15px;
                cursor: pointer;
                border-radius: 10px;
                transition: background-color 0.3s ease;
            }
        
            #custom-download-button:hover {
                background-color: rgb(13, 95, 50);
            }
        `;
        document.head.appendChild(style);


        const button = document.createElement('button');
        button.id = 'custom-download-button';
        button.textContent = 'Download';

        button.addEventListener('click', () => {
            const currentLink = window.location.href;

            // Send data to the service worker
            chrome.runtime.sendMessage({
                action: 'downloadVideo',
                payload: {
                    currentLink
                }
            }, (response) => {
                if (response && response.success) {
                    console.log('Download started!');
                } else {
                    console.error('Failed to start download: ', response?.error);
                }
            });


            
            button.style.backgroundColor = 'rgb(75, 185, 44)';
            setTimeout(() => {
                button.style.backgroundColor = '';
            }, 250)
        });

        menuContainer.appendChild(button);
    };

    const observer = new MutationObserver(() => {
        injectButton();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    injectButton();
})();