// The page around the game: touch controls, the iOS keyboard, save backups and
// offline support. It runs before crawl.js, which picks up window.Module.
(() => {
'use strict';

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const statusLine = $('status');

window.Module = {
  canvas,
  setStatus(text) {
    // The data download reports "Downloading data... (loaded/total)".
    const progress = text.match(/\((\d+)\/(\d+)\)/);
    statusLine.textContent = progress
      ? `Downloading game data… ${Math.floor(100 * progress[1] / progress[2])}%`
      : text;
    statusLine.hidden = !text;
  },
  // Leaving the main menu ends the game, but a phone app has nowhere to go
  // back to, so start over. After an error, leave the message up instead.
  onGameEnd: status => Module.persist().then(() => {
    if (status)
      stopped('Crawl stopped after an error.');
    else
      location.reload();
  }),
  onAbort: what => stopped(`Crawl crashed: ${what}.`),
  // Runs once the game has loaded, so the downloads don't compete.
  postRun: [() => {
    loaded = true;
    navigator.serviceWorker?.register('sw.js')
      .catch(err => console.warn('No offline support:', err));
    navigator.storage?.persist?.();
  }],
};

function stopped(message) {
  Module.setStatus(`${message} Tap to restart.`);
  Module.setStatus = () => {}; // later progress must not replace the message
  statusLine.onclick = () => location.reload();
}

// A failed download would otherwise leave the page stuck on its progress.
let loaded = false;
const loadFailed = () => {
  if (!loaded)
    stopped('Could not load the game. Check your connection.');
};
addEventListener('unhandledrejection', loadFailed);
addEventListener('error', e => {
  if (e.target instanceof HTMLScriptElement)
    loadFailed();
}, true);

// iOS can take the GPU away from a page in the background. The game's textures
// are gone then, so restart it, which resumes the saved game.
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  Module.setStatus('Restoring the game…');
  if (!document.hidden) {
    Module.restart();
    return;
  }
  document.addEventListener('visibilitychange', () => Module.restart(),
                            { once: true });
});

// Pinching would zoom the page, which touch-action doesn't stop on iOS.
document.addEventListener('gesturestart', e => e.preventDefault());

// Keys reach crawl as synthetic DOM events, which SDL reads like real ones.
const KEY_CODES = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, PageUp: 33, PageDown: 34,
  End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
};
const MODIFIER_KEYS = {
  shift: ['Shift', 'ShiftLeft', 16],
  ctrl: ['Control', 'ControlLeft', 17],
};
let ctrlArmed = false;

function dispatchKey(type, key, code, keyCode, mods, charCode = 0) {
  const event = new KeyboardEvent(type, {
    key, code, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift,
    bubbles: true, cancelable: true,
  });
  // The constructor can't set these legacy fields, but SDL reads them.
  Object.defineProperties(event, {
    keyCode: { value: keyCode },
    charCode: { value: charCode },
    which: { value: keyCode || charCode },
  });
  dispatchEvent(event);
}

// key is a KeyboardEvent.key value: a key name from KEY_CODES or a character.
function sendKey(key, mods = {}) {
  if (ctrlArmed) {
    mods = { ...mods, ctrl: true };
    setCtrl(false);
  }
  const named = key in KEY_CODES;
  const upper = key.toUpperCase();
  const code = named ? key
             : /^[A-Z]$/.test(upper) ? `Key${upper}`
             : /^[0-9]$/.test(key) ? `Digit${key}` : '';
  const keyCode = named ? KEY_CODES[key] : code ? upper.charCodeAt(0) : 0;
  // SDL tracks modifiers through their own key events.
  const held = Object.keys(MODIFIER_KEYS).filter(mod => mods[mod]);
  for (const mod of held)
    dispatchKey('keydown', ...MODIFIER_KEYS[mod], mods);
  dispatchKey('keydown', key, code, keyCode, mods);
  // Characters reach crawl as text input, which SDL makes from keypresses.
  if (!named && !mods.ctrl)
    dispatchKey('keypress', key, code, keyCode, mods, key.codePointAt(0));
  dispatchKey('keyup', key, code, keyCode, mods);
  for (const mod of held.reverse())
    dispatchKey('keyup', ...MODIFIER_KEYS[mod], {});
}

const ctrlButton = $('ctrl-button');
function setCtrl(on) {
  ctrlArmed = on;
  ctrlButton.classList.toggle('on', on);
}

const HOLD_MS = 400;

// Buttons being pressed. iOS may never report the end of a touch when a system
// gesture takes over, so these are also released when the page is hidden.
const pressedButtons = new Set();

// Buttons act on touch, and block the default handling so that they never
// take focus, which would hide the iOS keyboard. release() gets false if the
// touch was cancelled.
function onButton(button, press, release = () => {}) {
  const finish = completed => {
    if (!pressedButtons.delete(finish))
      return;
    button.classList.remove('pressed');
    release(completed);
  };
  const start = e => {
    e.preventDefault();
    pressedButtons.add(finish);
    button.classList.add('pressed');
    press();
  };
  const end = e => {
    e.preventDefault();
    finish(e.type === 'touchend' || e.type === 'mouseup');
  };
  button.addEventListener('touchstart', start, { passive: false });
  button.addEventListener('mousedown', start);
  for (const type of ['touchend', 'touchcancel', 'mouseup', 'mouseleave'])
    button.addEventListener(type, end);
}

// data-key is sent on press. With data-hold, a tap sends it on release, and a
// hold sends data-hold instead: either a key, or "shift" for shift+data-key.
for (const button of document.querySelectorAll('[data-key]')) {
  const { key, hold } = button.dataset;
  if (!hold) {
    onButton(button, () => sendKey(key));
    continue;
  }
  let timer = 0;
  onButton(button, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      if (hold === 'shift')
        sendKey(key, { shift: true });
      else
        sendKey(hold);
    }, HOLD_MS);
  }, completed => {
    if (timer && completed)
      sendKey(key);
    clearTimeout(timer);
    timer = 0;
  });
}

onButton(ctrlButton, () => setCtrl(!ctrlArmed));

// The keypad has every other key, for commands and prompts, without the iOS
// keyboard hiding half of the game. It closes once a key is pressed.
const PAD_ROWS = [
  ['`1234567890-=', '~!@#$%^&*()_+'],
  ['qwertyuiop[]\\', 'QWERTYUIOP{}|'],
  ["asdfghjkl;'", 'ASDFGHJKL:"'],
  ['zxcvbnm,./', 'ZXCVBNM<>?'],
];
const pad = $('pad');
const padShift = $('pad-shift');
const padKeys = [];
let padShifted = false;

function setPadShift(on) {
  padShifted = on;
  padShift.classList.toggle('on', on);
  for (const { button, plain, shifted } of padKeys)
    button.textContent = on ? shifted : plain;
}

function showPad(show) {
  pad.hidden = !show;
  $('menu-button').classList.toggle('on', show);
  setPadShift(false);
}

const padRows = $('pad-keys');
for (const [plainRow, shiftedRow] of PAD_ROWS) {
  const row = padRows.appendChild(document.createElement('div'));
  [...plainRow].forEach((plain, i) => {
    const shifted = shiftedRow[i];
    const button = row.appendChild(document.createElement('button'));
    button.textContent = plain;
    padKeys.push({ button, plain, shifted });
    onButton(button, () => {
      sendKey(padShifted ? shifted : plain);
      showPad(false);
    });
  });
}
onButton(padShift, () => setPadShift(!padShifted));
onButton($('pad-space'), () => {
  sendKey(' ');
  showPad(false);
});
onButton($('pad-close'), () => showPad(false));
onButton($('menu-button'), () => showPad(pad.hidden));

// The iOS keyboard types into a hidden input; its keys are passed on to SDL.
const kbd = $('kbd');
const kbdButton = $('kbd-button');
// iOS reports no Backspace from an empty field, so it always holds this
// invisible character for Backspace to delete.
const KBD_FILLER = '​';
const resetKbd = () => {
  kbd.value = KBD_FILLER;
};
onButton(kbdButton, () => {}, completed => {
  // iOS only raises the keyboard when focus() runs in a touchend or click.
  if (completed)
    document.activeElement === kbd ? kbd.blur() : kbd.focus();
});
kbd.addEventListener('focus', () => {
  kbdButton.classList.add('on');
  resetKbd();
});
kbd.addEventListener('blur', () => {
  kbdButton.classList.remove('on');
  document.body.style.paddingBottom = '';
  // iOS can leave the page scrolled after the keyboard closes.
  scrollTo(0, 0);
});
kbd.addEventListener('keydown', e => {
  e.stopPropagation();
  // Keys being composed by an input method arrive as text instead.
  if (e.isComposing || e.keyCode === 229 || e.metaKey)
    return;
  const named = e.key in KEY_CODES;
  if (named || [...e.key].length === 1) {
    e.preventDefault();
    sendKey(e.key, { ctrl: e.ctrlKey, shift: named && e.shiftKey });
  }
});
kbd.addEventListener('keypress', e => e.stopPropagation());
kbd.addEventListener('keyup', e => e.stopPropagation());
// Text that comes without key events, as from dictation or suggestions, and
// deletions that come without a Backspace key event.
const sendTyped = () => {
  if (kbd.value.includes(KBD_FILLER)) {
    for (const char of kbd.value.replace(KBD_FILLER, ''))
      sendKey(char);
  } else {
    sendKey('Backspace');
  }
  resetKbd();
};
kbd.addEventListener('input', e => e.isComposing || sendTyped());
kbd.addEventListener('compositionend', sendTyped);

// The iOS keyboard covers the bottom of the page without resizing it. In
// portrait, crawl shows messages below the map, so the game is lifted above
// the keyboard, which covers the controls instead. Landscape is too short to
// lift the game, but crawl shows messages above the map there. The heights
// also differ briefly during a rotation, so only trust them while typing.
const controls = $('controls');
const portrait = matchMedia('(orientation: portrait)');
window.visualViewport?.addEventListener('resize', () => {
  const covered = document.documentElement.clientHeight - visualViewport.height;
  const typing = document.activeElement === kbd && portrait.matches;
  document.body.style.paddingBottom =
    typing ? `${Math.max(0, covered - controls.offsetHeight)}px` : '';
});

// SDL only rereads the canvas size on a window resize event, but iOS can finish
// laying out a rotation after sending it.
new ResizeObserver(() => dispatchEvent(new Event('resize'))).observe(canvas);

// Touches on the game: a tap clicks, a hold right-clicks (describe), and a
// drag scrolls. SDL never sees the touches themselves.
const game = $('game');
const DRAG_PX = 10;
const SCROLL_STEP_PX = 20; // how far crawl scrolls per wheel step
let touch = null;

function mouse(type, x, y, button = 0) {
  canvas.dispatchEvent(new MouseEvent(type, {
    clientX: x, clientY: y, button, bubbles: true, cancelable: true,
  }));
}

function click(x, y, button) {
  mouse('mousemove', x, y); // SDL takes the position from mouse moves
  mouse('mousedown', x, y, button);
  mouse('mouseup', x, y, button);
}

function trackedTouch(e) {
  return [...e.changedTouches].find(t => t.identifier === touch?.id);
}

function forgetTouch() {
  clearTimeout(touch?.timer);
  touch = null;
}

const listen = (type, handler) => game.addEventListener(type, e => {
  e.preventDefault();
  e.stopPropagation();
  handler(e);
}, { capture: true, passive: false });

listen('touchstart', e => {
  if ([...e.touches].some(t => t.identifier === touch?.id))
    return; // one finger at a time
  forgetTouch(); // if any, its end was never reported
  const t = e.changedTouches[0];
  const current = touch = {
    id: t.identifier, x: t.clientX, y: t.clientY,
    scrolledX: t.clientX, scrolledY: t.clientY, dragging: false, held: false,
  };
  current.timer = setTimeout(() => {
    current.held = true;
    click(current.x, current.y, 2);
  }, HOLD_MS);
});

listen('touchmove', e => {
  const t = trackedTouch(e);
  if (!t || touch.held)
    return;
  if (!touch.dragging
      && Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > DRAG_PX)
  {
    touch.dragging = true;
    clearTimeout(touch.timer);
    // The map doesn't scroll, and a mouse move would show a tooltip on it.
    touch.scrolling = !!Module._wasm_has_layout?.();
    if (touch.scrolling)
      mouse('mousemove', touch.x, touch.y); // wheel events go where the mouse is
  }
  if (!touch.scrolling)
    return;
  // Dragging the content up scrolls down, as usual on touchscreens.
  for (const [axis, position] of [['X', t.clientX], ['Y', t.clientY]]) {
    const steps = Math.trunc((touch[`scrolled${axis}`] - position) / SCROLL_STEP_PX);
    touch[`scrolled${axis}`] -= steps * SCROLL_STEP_PX;
    for (let i = 0; i < Math.abs(steps); i++) {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        clientX: touch.x, clientY: touch.y,
        [`delta${axis}`]: 100 * Math.sign(steps),
        bubbles: true, cancelable: true,
      }));
    }
  }
});

const endTouch = e => {
  if (!trackedTouch(e))
    return;
  if (e.type === 'touchend' && !touch.dragging && !touch.held)
    click(touch.x, touch.y, 0);
  forgetTouch();
};
listen('touchend', endTouch);
listen('touchcancel', endTouch);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden)
    return;
  forgetTouch();
  for (const finish of [...pressedButtons])
    finish(false);
});

// Keeps the screen on during play, since reading a turn can outlast the
// auto-lock, but lets it sleep once the phone has been left alone.
const AWAKE_MS = 5 * 60 * 1000;
let wakeLock = null;
let awakeTimer = 0;
addEventListener('touchend', () => {
  clearTimeout(awakeTimer);
  awakeTimer = setTimeout(() => wakeLock?.then(lock => lock?.release()), AWAKE_MS);
  if (wakeLock || document.hidden || !navigator.wakeLock)
    return;
  wakeLock = navigator.wakeLock.request('screen').then(lock => {
    lock.onrelease = () => {
      wakeLock = null;
    };
    return lock;
  }).catch(() => {
    wakeLock = null;
  });
}, { capture: true, passive: true });

// The menu: save backups.
const menu = $('menu');
onButton($('pad-backups'), () => {}, completed => {
  if (completed) {
    showPad(false);
    menu.showModal();
  }
});
$('close-button').onclick = () => menu.close();

$('export-button').onclick = async () => {
  let file;
  try {
    const now = new Date();
    const pad2 = n => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    file = new File([Module.exportSaves()], `crawl-saves-${date}.tar`,
                    { type: 'application/x-tar' });
  } catch (err) {
    alert(`Could not export the saves: ${err.message}`);
    return;
  }
  // On iOS, the share sheet is how a Home Screen app saves a file.
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] }).catch(() => {});
    return;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
};

const importFile = $('import-file');
$('import-button').onclick = () => importFile.click();
importFile.onchange = async () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file || !confirm(`Restore the saves in ${file.name}? Saves with the `
                        + 'same names are replaced, and the game restarts.'))
  {
    return;
  }
  try {
    await Module.importSaves(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    alert(`Could not import ${file.name}: ${err.message}`);
  }
};
})();
