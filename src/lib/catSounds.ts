import { acquireAudioFocus } from "./audioFocus";

let activeCatAudio: HTMLAudioElement | null = null;
let releaseFocus: (() => void) | null = null;

export function stopCatAudio() {
  if (!activeCatAudio) {
    if (releaseFocus) {
      releaseFocus();
      releaseFocus = null;
    }
    return;
  }
  activeCatAudio.pause();
  activeCatAudio.currentTime = 0;
  activeCatAudio = null;
  if (releaseFocus) {
    releaseFocus();
    releaseFocus = null;
  }
}

export function playCatAudio(soundType: string) {
  const urls: Record<string, string> = {
    happy_purr: 'https://actions.google.com/sounds/v1/animals/cat_purr_close.ogg',
    demand_meow: 'https://actions.google.com/sounds/v1/animals/cat_meow_x2.ogg',
    angry_hiss: 'https://actions.google.com/sounds/v1/animals/cat_hissing.ogg',
    greeting_trill: 'https://actions.google.com/sounds/v1/animals/kitten_meow.ogg',
    sad_cry: 'https://actions.google.com/sounds/v1/animals/cat_yowl.ogg'
  };
  const url = urls[soundType] || urls['demand_meow'];
  stopCatAudio();
  const audio = new Audio(url);
  activeCatAudio = audio;
  if (!releaseFocus) {
    releaseFocus = acquireAudioFocus("cat-sound", () => {
      stopCatAudio();
    });
  }
  audio.onended = () => {
    if (activeCatAudio === audio) {
      activeCatAudio = null;
    }
    if (releaseFocus) {
      releaseFocus();
      releaseFocus = null;
    }
  };
  audio.onerror = () => {
    if (activeCatAudio === audio) {
      activeCatAudio = null;
    }
    if (releaseFocus) {
      releaseFocus();
      releaseFocus = null;
    }
  };
  audio.play().catch(e => console.error("Audio play failed", e));
}
