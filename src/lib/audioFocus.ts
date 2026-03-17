type FocusOwner = "live-stream" | "cat-sound" | "diary-tts" | "misc";

type FocusState = {
  owner: FocusOwner;
  acquiredAt: number;
  revoke: () => void;
} | null;

let currentFocus: FocusState = null;

function pushFocusDebug(event: string, payload: Record<string, unknown>) {
  const win = window as Window & { __audioFocusDebug?: Array<Record<string, unknown>> };
  if (!win.__audioFocusDebug) {
    win.__audioFocusDebug = [];
  }
  win.__audioFocusDebug.push({ ts: Date.now(), event, ...payload });
  if (win.__audioFocusDebug.length > 300) {
    win.__audioFocusDebug.shift();
  }
}

export function acquireAudioFocus(owner: FocusOwner, onRevoke: () => void) {
  if (currentFocus && currentFocus.owner !== owner) {
    try {
      currentFocus.revoke();
    } catch {
    }
    pushFocusDebug("focus_preempt", { from: currentFocus.owner, to: owner });
  }
  currentFocus = { owner, acquiredAt: Date.now(), revoke: onRevoke };
  pushFocusDebug("focus_acquire", { owner });
  return () => {
    if (currentFocus?.owner === owner) {
      currentFocus = null;
      pushFocusDebug("focus_release", { owner });
    }
  };
}

export function revokeAudioFocus(reason = "manual") {
  if (!currentFocus) {
    return;
  }
  const owner = currentFocus.owner;
  try {
    currentFocus.revoke();
  } catch {
  }
  currentFocus = null;
  pushFocusDebug("focus_revoke", { owner, reason });
}

export function getAudioFocusOwner() {
  return currentFocus?.owner || null;
}
