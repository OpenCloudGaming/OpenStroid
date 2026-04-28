const backendInput = document.getElementById('backendBaseUrl');
const pairingInput = document.getElementById('pairingCode');
const statusElement = document.getElementById('status');
const saveButton = document.getElementById('save');
const openButton = document.getElementById('open');
const captureNowButton = document.getElementById('captureNow');
const refreshButton = document.getElementById('refresh');

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
    pairingInput.value = response.pairingCode || '';
    setStatus(response);
  });
}

saveButton.addEventListener('click', () => {
  chrome.runtime.sendMessage(
    {
      type: 'openstroid:set-settings',
      backendBaseUrl: backendInput.value,
      pairingCode: pairingInput.value,
    },
    () => refreshState(),
  );
});

openButton.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://boosteroid.com/' });
});

captureNowButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'openstroid:submit-now' }, () => refreshState());
});

refreshButton.addEventListener('click', refreshState);

refreshState();
