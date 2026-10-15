// Keyboard shortcut normalisation and matching.

const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  NumpadAdd: '=',
  NumpadSubtract: '-',
  Space: 'Space',
};

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Escape: 'Escape',
  Enter: 'Enter',
  Tab: 'Tab',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
};

/** "Ctrl+Shift+Z" style string for a keyboard event, or '' for bare modifier presses. */
export function eventToShortcut(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): string {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return '';
  let key: string;
  if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = e.code.slice(6);
  else if (KEY_NAMES[e.key]) key = KEY_NAMES[e.key];
  else if (/^F\d{1,2}$/.test(e.key)) key = e.key;
  else if (e.key.length === 1) key = e.key.toUpperCase();
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else key = e.key;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export function normalizeShortcut(s: string): string {
  const parts = s
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return '';
  const key = parts.pop()!;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const out: string[] = [];
  if (mods.has('ctrl') || mods.has('cmd') || mods.has('meta')) out.push('Ctrl');
  if (mods.has('alt')) out.push('Alt');
  if (mods.has('shift')) out.push('Shift');
  out.push(key.length === 1 ? key.toUpperCase() : key);
  return out.join('+');
}

export function formatShortcut(s: string): string {
  return s.replace(/\+/g, ' + ').replace('Ctrl', 'Ctrl').replace('Space', 'Space');
}

export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return false;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'range', 'button', 'color'].includes(target.type);
  }
  return false;
}
