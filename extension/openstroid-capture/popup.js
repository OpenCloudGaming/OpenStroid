const backendInput = document.getElementById('backendBaseUrl');
const pairingInput = document.getElementById('pairingCode');
const statusTitle = document.getElementById('statusTitle');
const statusBadge = document.getElementById('statusBadge');
const statusMessage = document.getElementById('statusMessage');
const eventCount = document.getElementById('eventCount');
const storageCount = document.getElementById('storageCount');
const debugOutput = document.getElementById('debugOutput');
const saveButton = document.getElementById('save');
const openButton = document.getElementById('open');
const captureNowButton = document.getElementById('captureNow');
const refreshButton = document.getElementById('refresh');

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ error: error.message || 'Extension background worker is unavailable.' });
        return;
      }
      resolve(response || {});
    });
  });
}

function setBusy(isBusy) {
  saveButton.disabled = isBusy;
  captureNowButton.disabled = isBusy;
  refreshButton.disabled = isBusy;
}

function setStatus({ title, badge, tone = '', message, state }) {
  statusTitle.textContent = title;
  statusBadge.textContent = badge;
  statusBadge.className = `badge ${tone}`.trim();
  statusMessage.textContent = message;
  debugOutput.textContent = JSON.stringify(state, null, 2);
}

function summarizeState(state) {
  if (state.error) {
    return {
      title: 'Extension Error',
      badge: 'Error',
      tone: 'error',
      message: state.error,
    };
  }

  if (!state.pairingCode) {
    return {
      title: 'Not Paired',
      badge: 'Needs Code',
      tone: 'warn',
      message: 'Start login in OpenStroid, copy the pairing code, paste it here, then save.',
    };
  }

  if (state.lastSubmissionResult?.ok && state.lastSubmissionResult?.status === 'succeeded') {
    return {
      title: 'Session Sent',
      badge: 'Done',
      tone: 'ok',
      message: 'OpenStroid received the captured Boosteroid session. Return to the desktop app.',
    };
  }

  if (state.lastActiveLookup?.ok) {
    return {
      title: 'Paired',
      badge: 'Waiting',
      tone: 'ok',
      message: 'Sign in on Boosteroid in this Chrome profile. The extension will submit the session automatically.',
    };
  }

  if (state.lastActiveLookup?.message) {
    return {
      title: 'Pairing Not Active',
      badge: 'Check App',
      tone: 'warn',
      message: state.lastActiveLookup.message,
    };
  }

  return {
    title: 'Ready',
    badge: 'Saved',
    tone: 'ok',
    message: 'Open Boosteroid and sign in. Use Capture Now if OpenStroid does not continue automatically.',
  };
}

async function refreshState() {
  setBusy(true);
  const state = await sendMessage({ type: 'openstroid:get-state' });
  backendInput.value = state.backendBaseUrl || backendInput.value || 'http://127.0.0.1:3001';
  pairingInput.value = state.pairingCode || pairingInput.value || '';
  eventCount.textContent = String(state.observedEventCount || 0);
  storageCount.textContent = String(state.storageItemCount || 0);
  setStatus({ ...summarizeState(state), state });
  setBusy(false);
}

saveButton.addEventListener('click', async () => {
  setBusy(true);
  const response = await sendMessage({
    type: 'openstroid:set-settings',
    backendBaseUrl: backendInput.value,
    pairingCode: pairingInput.value,
  });
  if (response.error) {
    setStatus({
      title: 'Save Failed',
      badge: 'Error',
      tone: 'error',
      message: response.error,
      state: response,
    });
    setBusy(false);
    return;
  }
  await refreshState();
});

openButton.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://boosteroid.com/' });
});

captureNowButton.addEventListener('click', async () => {
  setBusy(true);
  const response = await sendMessage({ type: 'openstroid:submit-now' });
  if (response.error) {
    setStatus({
      title: 'Capture Failed',
      badge: 'Error',
      tone: 'error',
      message: response.error,
      state: response,
    });
    setBusy(false);
    return;
  }
  await refreshState();
});

refreshButton.addEventListener('click', refreshState);

void refreshState();
