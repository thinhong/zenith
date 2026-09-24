/**
 * The words of a day on the glass, and the few buttons a day needs. Plain
 * DOM, like the thoughts (PLAN.md 5, "Text"), and as quiet: a line over
 * whoever is speaking, your own words and thoughts along the foot of the
 * screen, two replies when there is a choice, and a way back up.
 */
export interface StoryUiHandlers {
  onChoose: (index: 0 | 1) => void;
  /** Talk to whoever is near, or go on to the next line. */
  onInteract: () => void;
  onRise: () => void;
  onResume: () => void;
}

export interface StoryUi {
  readonly touch: boolean;
  setVisible: (visible: boolean) => void;
  /** Somebody speaking, over their head. `at` null puts the line at the foot of the screen. */
  say: (text: string | null, name?: string, at?: { x: number; y: number } | null) => void;
  /** Your own words, a thought, or a voice on the telephone, along the foot of the screen. */
  line: (text: string | null, kind?: 'me' | 'think' | 'voice', name?: string) => void;
  aim: (text: string | null) => void;
  choices: (labels: readonly [string, string] | null) => void;
  prompt: (text: string | null) => void;
  /** Whether "go on" is waiting: a small arrow for a thumb. */
  waiting: (on: boolean) => void;
  menu: (open: boolean) => void;
  menuOpen: () => boolean;
  hint: (text: string | null) => void;
  /** An echo of the guiding light on the edge of the glass, when the light itself is out of view. */
  beacon: (at: { x: number; y: number } | null) => void;
  veil: (opacity: number) => void;
  closing: (text: string | null, opacity?: number) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

export function createStoryUi(handlers: StoryUiHandlers): StoryUi {
  const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const root = document.createElement('div');
  root.id = 'story';
  root.classList.add('hidden');
  if (touch) root.classList.add('touch');
  document.body.appendChild(root);

  const veil = el('div', 'veil', root);
  const bubble = el('div', 'say', root);
  const bubbleWho = el('div', 'who', bubble);
  const bubbleText = el('div', 'text', bubble);

  const foot = el('div', 'foot', root);
  const aim = el('div', 'aim', foot);
  const line = el('div', 'line', foot);
  const lineWho = el('span', 'who', line);
  const lineText = el('span', 'text', line);
  const choices = el('div', 'choices', foot);
  const replies = [el('button', 'reply', choices), el('button', 'reply', choices)] as const;
  replies.forEach((button, index) => {
    button.type = 'button';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onChoose(index === 0 ? 0 : 1);
    });
  });
  const prompt = el('button', 'prompt', foot);
  prompt.type = 'button';
  prompt.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onInteract();
  });

  const next = el('button', 'next', root);
  next.type = 'button';
  next.textContent = '›';
  next.title = 'Go on';
  next.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onInteract();
  });

  const rise = el('button', 'rise', root);
  rise.type = 'button';
  rise.textContent = '↑';
  rise.title = 'Rise out of this day (Esc)';
  rise.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onRise();
  });

  const hint = el('div', 'hint', root);
  const beacon = el('div', 'beacon', root);
  const closing = el('div', 'closing', root);

  const menu = el('div', 'menu hidden', root);
  const resume = el('button', 'wide', menu);
  resume.type = 'button';
  resume.textContent = 'Go on';
  resume.addEventListener('click', () => handlers.onResume());
  const leave = el('button', 'wide', menu);
  leave.type = 'button';
  leave.textContent = 'Rise out of this day';
  leave.addEventListener('click', () => handlers.onRise());
  const keys = el('div', 'keys', menu);
  keys.innerHTML = (
    touch
      ? ['<b>Left thumb</b> to walk', '<b>Right thumb</b> to look', '<b>Tap</b> to talk and go on']
      : [
          '<b>W A S D</b> to walk, <b>Shift</b> to hurry',
          '<b>Mouse</b> to look (click to hold it)',
          '<b>E</b> or <b>Space</b> to talk and go on',
          '<b>1</b> and <b>2</b> to reply',
        ]
  )
    .map((row) => `<div>${row}</div>`)
    .join('');

  const show = (node: HTMLElement, on: boolean): void => {
    node.classList.toggle('on', on);
  };

  return {
    touch,
    setVisible: (visible) => {
      root.classList.toggle('hidden', !visible);
    },
    say: (text, name, at) => {
      if (!text) {
        show(bubble, false);
        return;
      }
      if (bubbleText.textContent !== text) bubbleText.textContent = text;
      bubbleWho.textContent = name ?? '';
      if (at) {
        bubble.classList.remove('low');
        bubble.style.transform = `translate(-50%, -100%) translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
      } else {
        bubble.classList.add('low');
        bubble.style.transform = '';
      }
      show(bubble, true);
    },
    line: (text, kind = 'me', name) => {
      if (!text) {
        show(line, false);
        return;
      }
      line.dataset.kind = kind;
      lineWho.textContent = kind === 'voice' ? `${name ?? ''}` : '';
      lineText.textContent = kind === 'me' ? `“${text}”` : text;
      show(line, true);
    },
    aim: (text) => {
      if (text && aim.textContent !== text) aim.textContent = text;
      show(aim, text !== null);
    },
    choices: (labels) => {
      if (!labels) {
        show(choices, false);
        return;
      }
      labels.forEach((label, index) => {
        const button = replies[index];
        if (button) button.innerHTML = touch ? '' : `<b>${index + 1}</b>`;
        if (button) button.append(label);
      });
      show(choices, true);
    },
    prompt: (text) => {
      if (text) prompt.innerHTML = touch ? text : `<b>E</b>${text}`;
      show(prompt, text !== null);
    },
    waiting: (on) => show(next, on && touch),
    menu: (open) => {
      menu.classList.toggle('hidden', !open);
    },
    menuOpen: () => !menu.classList.contains('hidden'),
    hint: (text) => {
      if (text) hint.textContent = text;
      show(hint, text !== null);
    },
    beacon: (at) => {
      if (at) beacon.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
      show(beacon, at !== null);
    },
    veil: (opacity) => {
      veil.style.opacity = opacity.toFixed(3);
    },
    closing: (text, opacity = 1) => {
      if (text && closing.textContent !== text) closing.textContent = text;
      closing.style.opacity = text ? opacity.toFixed(3) : '0';
    },
  };
}
