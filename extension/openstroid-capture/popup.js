const backendInput = document.getElementById('backendBaseUrl');
const statusElement = document.getElementById('status');
const saveButton = document.getElementById('save');
const openButton = document.getElementById('open');

function setStatus(state) {
  statusElement.textContent = JSON.stringify(state, null, 2);
}

function refreshState() {
  chrome.runtime.sendMessage({ type: 'openstroid:get-state' }, (response) => {
    if (!response) {
      setStatus({ error: 'Extension state unavailable.' });
      return;
    }
    backendInput.value = response.backendBaseUrl;
    setStatus(response);
  });
}

saveButton.addEventListener('click', () => {
  chrome.runtime.sendMessage(
    { type: 'openstroid:set-backend-base-url', backendBaseUrl: backendInput.value },
    () => refreshState(),
  );
});

openButton.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://boosteroid.com/' });
});

refreshState();
