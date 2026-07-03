const AXIS_THRESHOLD = 1200;
const MAX_AXIS = 32767;
const MAX_RUMBLE = 65535;
const GAMEPAD_LISTENER_DELAY_MS = 2000;

const PS5_DUPLICATE_HID =
  'HID-compliant game controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';

export type StreamPlatform = 'win' | 'mac' | 'lin' | 'a';

export interface GamepadControllerOptions {
  sendEvent: (data: Record<string, unknown>) => void;
  detectPlatform: () => StreamPlatform;
  onActiveCountChange?: (count: number) => void;
  onRelease?: () => void;
}

interface ConnectedGamepad {
  gamepad: Gamepad;
  duplicated: boolean;
}

function getGamepads(): (Gamepad | null)[] {
  if (typeof navigator.getGamepads === 'function') {
    return Array.from(navigator.getGamepads());
  }

  const legacy = navigator as Navigator & {
    webkitGetGamepads?: () => (Gamepad | null)[];
  };
  if (typeof legacy.webkitGetGamepads === 'function') {
    return Array.from(legacy.webkitGetGamepads());
  }

  return [];
}

function isIphone(): boolean {
  return /iphone/i.test(navigator.userAgent);
}

function mapButtonIndexForDevice(gamepad: Gamepad, originalIndex: number): number {
  if (gamepad.id.toLowerCase().includes('f310')) {
    if (originalIndex === 2) return 3;
    if (originalIndex === 3) return 2;
  }
  return originalIndex;
}

function buttonValue(button: GamepadButton): number {
  return typeof button === 'object' ? button.value : Number(button);
}

function analogAxisValue(value: number): number {
  return Math.round(value * MAX_AXIS * 2) - MAX_AXIS;
}

export class GamepadController {
  private readonly sendEvent: GamepadControllerOptions['sendEvent'];
  private readonly detectPlatform: GamepadControllerOptions['detectPlatform'];
  private readonly onActiveCountChange?: GamepadControllerOptions['onActiveCountChange'];
  private readonly onRelease?: GamepadControllerOptions['onRelease'];

  private readonly ids = new Map<number, number>();
  private readonly controllers = new Map<number, ConnectedGamepad>();
  private readonly padButtons = new Map<number, number[]>();
  private readonly padAxis = new Map<number, number[]>();

  private rafId: number | null = null;
  private listenerDelayTimer: number | null = null;
  private started = false;
  private boundHandleConnected: ((event: GamepadEvent) => void) | null = null;
  private boundHandleDisconnected: ((event: GamepadEvent) => void) | null = null;

  constructor(options: GamepadControllerOptions) {
    this.sendEvent = options.sendEvent;
    this.detectPlatform = options.detectPlatform;
    this.onActiveCountChange = options.onActiveCountChange;
    this.onRelease = options.onRelease;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.boundHandleConnected = (event) => {
      this.addGamepad(event.gamepad);
    };
    this.boundHandleDisconnected = (event) => {
      this.removeGamepad(event.gamepad);
    };

    this.listenerDelayTimer = window.setTimeout(() => {
      this.listenerDelayTimer = null;
      if (!this.started) return;
      window.addEventListener('gamepadconnected', this.boundHandleConnected!);
      window.addEventListener('gamepaddisconnected', this.boundHandleDisconnected!);
      this.scanGamepads();
    }, GAMEPAD_LISTENER_DELAY_MS);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.listenerDelayTimer !== null) {
      window.clearTimeout(this.listenerDelayTimer);
      this.listenerDelayTimer = null;
    }

    if (this.boundHandleConnected) {
      window.removeEventListener('gamepadconnected', this.boundHandleConnected);
      this.boundHandleConnected = null;
    }
    if (this.boundHandleDisconnected) {
      window.removeEventListener('gamepaddisconnected', this.boundHandleDisconnected);
      this.boundHandleDisconnected = null;
    }

    for (const [padIndex, entry] of this.controllers.entries()) {
      if (!entry.duplicated) {
        const serverId = this.ids.get(padIndex);
        if (serverId !== undefined) {
          this.sendEvent({
            type: 'controller',
            action: 'disconnected',
            id: serverId,
          });
        }
      }
    }

    this.cancelUpdate();
    this.controllers.clear();
    this.ids.clear();
    this.padButtons.clear();
    this.padAxis.clear();
    this.notifyActiveCount();
  }

  getActiveCount(): number {
    let count = 0;
    for (const [padIndex, entry] of this.controllers.entries()) {
      if (!entry.duplicated && this.ids.has(padIndex)) {
        count += 1;
      }
    }
    return count;
  }

  handleServerMessage(message: Record<string, unknown>): void {
    const action = typeof message.action === 'string' ? message.action : '';

    if (action === 'connected') {
      this.connectController(message);
      return;
    }

    if (action === 'rumble') {
      const id = typeof message.id === 'number' ? message.id : null;
      const left = typeof message.left === 'number' ? message.left : 0;
      const right = typeof message.right === 'number' ? message.right : 0;
      if (id !== null) {
        this.vibrate(id, left, right);
      }
    }
  }

  private notifyActiveCount(): void {
    this.onActiveCountChange?.(this.getActiveCount());
  }

  private hasActiveControllers(): boolean {
    return this.controllers.size > 0;
  }

  private ensurePadState(padIndex: number): void {
    if (!this.padButtons.has(padIndex)) {
      this.padButtons.set(padIndex, []);
    }
    if (!this.padAxis.has(padIndex)) {
      this.padAxis.set(padIndex, []);
    }
  }

  private getPadIndexById(gamepadId: number): number | undefined {
    for (const [padIndex, serverId] of this.ids.entries()) {
      if (serverId === gamepadId) {
        return padIndex;
      }
    }
    return undefined;
  }

  private canSendInput(gamepadId: number | undefined, padIndex: number | null): boolean {
    if (gamepadId === undefined || gamepadId === null) {
      return false;
    }

    const localPadIndex = padIndex ?? this.getPadIndexById(gamepadId);
    if (localPadIndex === undefined) {
      return false;
    }

    const entry = this.controllers.get(localPadIndex);
    return !!entry && !entry.duplicated;
  }

  private scheduleUpdate(): void {
    if (this.rafId !== null || !this.hasActiveControllers()) {
      return;
    }

    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      this.updateStatus();
    });
  }

  private cancelUpdate(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private connectController(message: Record<string, unknown>): void {
    const name = typeof message.name === 'string' ? message.name : '';
    const serverId = typeof message.id === 'number' ? message.id : null;
    if (!name || serverId === null) return;

    for (const [padIndex, entry] of this.controllers.entries()) {
      const controllerName = `${entry.gamepad.id}${padIndex}`;
      if (controllerName === name) {
        this.ids.set(padIndex, serverId);
        this.notifyActiveCount();
        this.updateStatus();
        break;
      }
    }
  }

  private isDuplicatedController(gamepad: Gamepad): boolean {
    return (
      gamepad.id.toLowerCase() === PS5_DUPLICATE_HID.toLowerCase() &&
      this.detectPlatform() === 'win'
    );
  }

  private addGamepad(gamepad: Gamepad): void {
    const duplicated = this.isDuplicatedController(gamepad);
    this.controllers.set(gamepad.index, { gamepad, duplicated });
    this.ensurePadState(gamepad.index);

    if (duplicated) {
      this.scheduleUpdate();
      return;
    }

    this.sendEvent({
      type: 'controller',
      action: 'connected',
      name: `${gamepad.id}${gamepad.index}`,
    });
    this.scheduleUpdate();
  }

  private removeGamepad(gamepad: Gamepad): void {
    const entry = this.controllers.get(gamepad.index);
    if (entry && !entry.duplicated) {
      const serverId = this.ids.get(gamepad.index);
      if (serverId !== undefined) {
        this.sendEvent({
          type: 'controller',
          action: 'disconnected',
          id: serverId,
        });
      }
    }

    this.controllers.delete(gamepad.index);
    this.ids.delete(gamepad.index);
    this.padButtons.delete(gamepad.index);
    this.padAxis.delete(gamepad.index);
    this.notifyActiveCount();

    if (!this.hasActiveControllers()) {
      this.cancelUpdate();
    }
  }

  private scanGamepads(): void {
    const pads = getGamepads();
    for (const pad of pads) {
      if (!pad) continue;

      const existing = this.controllers.get(pad.index);
      if (existing) {
        this.controllers.set(pad.index, { gamepad: pad, duplicated: existing.duplicated });
      } else {
        this.addGamepad(pad);
      }
    }
  }

  private updateStatus(): void {
    this.scanGamepads();

    for (const [index, entry] of this.controllers.entries()) {
      const gamepad = entry.gamepad;
      const padIndex = Number(index);
      const streamControllerId = this.ids.get(padIndex);
      this.ensurePadState(padIndex);

      const buttons = this.padButtons.get(padIndex) ?? [];
      const axes = this.padAxis.get(padIndex) ?? [];

      for (let i = 0; i < gamepad.buttons.length; i += 1) {
        const mappedIndex = mapButtonIndexForDevice(gamepad, i);
        const rawValue = buttonValue(gamepad.buttons[i]);
        const roundVal = analogAxisValue(rawValue);
        const oldVal = buttons[mappedIndex] ?? 0;

        if (oldVal === rawValue) {
          continue;
        }

        if (i === 6) {
          this.sendAxisEvent(2, roundVal, streamControllerId, padIndex);
        } else if (i === 7) {
          this.sendAxisEvent(5, roundVal, streamControllerId, padIndex);
        } else if (i > 7 && i < 12) {
          const button8 = buttonValue(gamepad.buttons[8]);
          const button9 = buttonValue(gamepad.buttons[9]);
          if (button8 && button9) {
            this.onRelease?.();
          }
          this.sendButtonEvent(i - 2, rawValue, streamControllerId, padIndex);
        } else if (i > 11 && i < 16) {
          const up = buttonValue(gamepad.buttons[12]);
          const down = buttonValue(gamepad.buttons[13]);
          const left = buttonValue(gamepad.buttons[14]);
          const right = buttonValue(gamepad.buttons[15]);

          if (up && left) {
            this.sendPadEvent(9, streamControllerId, padIndex);
          } else if (up && right) {
            this.sendPadEvent(3, streamControllerId, padIndex);
          } else if (down && left) {
            this.sendPadEvent(12, streamControllerId, padIndex);
          } else if (down && right) {
            this.sendPadEvent(6, streamControllerId, padIndex);
          } else if (up) {
            this.sendPadEvent(1, streamControllerId, padIndex);
          } else if (right) {
            this.sendPadEvent(2, streamControllerId, padIndex);
          } else if (down) {
            this.sendPadEvent(4, streamControllerId, padIndex);
          } else if (left) {
            this.sendPadEvent(8, streamControllerId, padIndex);
          } else {
            this.sendPadEvent(0, streamControllerId, padIndex);
          }
        } else {
          this.sendButtonEvent(mappedIndex, rawValue, streamControllerId, padIndex);
        }

        buttons[mappedIndex] = rawValue;
      }

      for (let i = 0; i < gamepad.axes.length; i += 1) {
        if (isIphone() && i > 3) {
          const axisValue = gamepad.axes[i];
          if (axisValue !== axes[i]) {
            switch (axisValue) {
              case 1:
                this.sendPadEvent(i > 4 ? 1 : 2, streamControllerId, padIndex);
                break;
              case -1:
                this.sendPadEvent(i > 4 ? 4 : 8, streamControllerId, padIndex);
                break;
              default:
                this.sendPadEvent(0, streamControllerId, padIndex);
            }
          }
          axes[i] = axisValue;
        } else {
          const aval = Math.round(gamepad.axes[i] * MAX_AXIS);
          const oldAxisVal = axes[i] ?? 0;
          const diff = Math.abs(oldAxisVal - aval);
          if (diff > AXIS_THRESHOLD) {
            const tempIndex = i > 1 ? i + 1 : i;
            this.sendAxisEvent(tempIndex, aval, streamControllerId, padIndex);
            axes[i] = aval;
          }
        }
      }
    }

    this.scheduleUpdate();
  }

  private sendButtonEvent(
    index: number,
    value: number,
    gamepadId: number | undefined,
    padIndex: number,
  ): void {
    if (!this.canSendInput(gamepadId, padIndex)) return;

    this.sendEvent({
      type: 'controller',
      action: 'button',
      id: gamepadId,
      button: index,
      value,
    });
  }

  private sendPadEvent(
    hat: number,
    gamepadId: number | undefined,
    padIndex: number,
  ): void {
    if (!this.canSendInput(gamepadId, padIndex)) return;

    this.sendEvent({
      type: 'controller',
      action: 'pad',
      id: gamepadId,
      hat,
    });
  }

  private sendAxisEvent(
    axisIndex: number,
    value: number,
    gamepadId: number | undefined,
    padIndex: number,
  ): void {
    if (!this.canSendInput(gamepadId, padIndex)) return;

    this.sendEvent({
      type: 'controller',
      action: 'axes',
      id: gamepadId,
      axes: axisIndex,
      value,
    });
  }

  private vibrate(gamepadId: number, left: number, right: number): void {
    const padIndex = this.getPadIndexById(gamepadId);
    const entry = padIndex !== undefined ? this.controllers.get(padIndex) : undefined;
    const gamepad = entry?.gamepad ?? this.controllers.get(0)?.gamepad;
    if (!gamepad?.vibrationActuator?.playEffect) {
      return;
    }

    void gamepad.vibrationActuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration: 400,
      weakMagnitude: right / MAX_RUMBLE,
      strongMagnitude: left / MAX_RUMBLE,
    });
  }
}
