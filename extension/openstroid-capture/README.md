# OpenStroid Capture Extension

This folder is the unpacked Chrome extension used by OpenStroid login.

## Load It In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:

   ```text
   C:\Users\Zortos\Projects\OpenStroid\extension\openstroid-capture
   ```

5. Start login in OpenStroid.
6. Copy the pairing code from OpenStroid into the extension popup.
7. Keep the bridge URL as `http://127.0.0.1:3001`.
8. Click `Save Pairing`, then `Open Boosteroid`.
9. Sign in normally on Boosteroid.

The extension does not automate login. It only observes the real Chrome session and sends the captured session evidence to your local OpenStroid bridge.
