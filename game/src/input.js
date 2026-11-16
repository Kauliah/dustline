// Keyboard and mouse, plus the pointer lock that turns the mouse into look.
// Plain browser APIs only. The caller reads keys from state.keys and handles
// reload (KeyR), buy toggle (KeyB) and mute (KeyM); this module only tracks.
export function createInput(dom, onLockChange) {
  const keys = new Set();
  const state = {
    keys,
    locked: false,
    firing: false,
    aiming: false,
    grenadeQueued: false,
    lookX: 0,
    lookY: 0,
  };

  function setKey(event, down) {
    if (event.code === 'Space') event.preventDefault();
    if (event.repeat) return;
    if (down) {
      keys.add(event.code);
      if (event.code === 'KeyG') state.grenadeQueued = true;
    } else {
      keys.delete(event.code);
    }
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
    state.aiming = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  dom.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === dom;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.aiming = false;
    }
    if (typeof onLockChange === 'function') onLockChange(state.locked);
  });

  return {
    state,
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    requestLock() {
      dom.requestPointerLock();
    },
    get locked() {
      return state.locked;
    },
    consumeGrenade() {
      const queued = state.grenadeQueued;
      state.grenadeQueued = false;
      return queued;
    },
  };
}
