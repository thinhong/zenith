import type { DayScript } from '@/story/script';

/**
 * Hue, 1800. Lài sells tea by the east gate of the citadel. Her younger
 * brother is sitting the court examination inside the walls today, and he
 * went in before dawn without eating. Their mother wants to know one thing
 * tonight: did he eat.
 */
export const CITADEL_DAY: DayScript = {
  era: 'citadel',
  title: 'Rice for Khôi',
  me: { name: 'Lài', age: 26 },
  places: {
    home: { kind: 'home', zone: 'outside', reach: [0.5, 0.9] },
    gate: { kind: 'landmark', landmark: 'eastGate' },
    market: { kind: 'market', zone: 'inside', from: 'gate', minM: 40, maxM: 230 },
    moat: { kind: 'landmark', landmark: 'moat' },
    halls: { kind: 'landmark', landmark: 'halls' },
  },
  cast: {
    ma: { name: 'Má', clothes: 0x5a4a66 },
    bao: { name: 'Bảo', clothes: 0x8a3a36 },
    sau: { name: 'Uncle Sáu', clothes: 0x6a6656 },
    dong: { name: 'Teacher Đông', clothes: 0x3c4a66 },
    khoi: { name: 'Khôi', clothes: 0xd8d0b8 },
    cat: { name: 'Cat', clothes: 0x8a8a8a, kind: 'cat' },
  },
  scenes: [
    {
      id: 'dawn',
      hour: 4.8,
      at: 'home',
      with: 'ma',
      aim: [{ text: 'Má is up. Of course Má is up.' }],
      talk: [
        { say: 'He left without eating. Again.' },
        { say: 'Sticky rice for him. In the good leaf.' },
        { say: "They don't let anyone into the exam, Má.", who: 'me' },
        { say: 'Then find someone they do let in.' },
        { say: 'Eat first, worry after. I told him. He never listens.' },
        {
          choose: [
            { label: "I'll get it to him. I promise.", set: ['promised'], then: [{ say: "Don't promise. Just do it." }] },
            { label: "I'll try. No promises.", set: ['tried'], then: [{ say: 'That is a promise wearing a coat.' }] },
          ],
        },
        { think: "The rice is still warm. It won't be by noon." },
      ],
    },
    {
      id: 'gate',
      hour: 6.6,
      at: 'gate',
      with: 'bao',
      aim: [{ text: 'Open the stall by the east gate. The guards want tea.' }],
      extras: [
        {
          who: 'cat',
          at: 'gate',
          offset: [3.2, 1.4],
          talk: [
            { think: 'A grey cat with one white paw. It likes the guards.' },
            {
              choose: [
                {
                  label: 'Give it a bit of rice cake.',
                  set: ['fedCat'],
                  then: [{ think: 'It takes it with enormous dignity.' }],
                },
                { label: 'Shoo. Not near the tea.', then: [{ think: 'It moves one step away. As a favour.' }] },
              ],
            },
          ],
        },
      ],
      talk: [
        { say: 'Tea. Strong. I was up all night.' },
        { say: 'Guarding what, at night?', who: 'me' },
        { say: 'The dark. Somebody has to.' },
        { say: 'Your brother went in this morning? The exam?' },
        {
          choose: [
            {
              label: 'Could you carry his rice in?',
              set: ['askedBao'],
              then: [
                { say: "I'd lose my post. And my ears, maybe." },
                { say: 'The old water-carrier goes in at noon. Ask him.' },
              ],
            },
            {
              label: "He did. He didn't eat.",
              set: ['toldBao'],
              then: [
                { say: "Mine didn't either, when I sat it. Failed twice." },
                { say: 'Now I guard the gate I failed through.' },
                { say: 'Ask old Sáu. He carries water in at noon.' },
              ],
            },
          ],
        },
        { say: "He's at the market inside the walls. Mind the tea." },
      ],
    },
    {
      id: 'market',
      hour: 10.8,
      at: 'market',
      with: 'sau',
      aim: [{ text: 'Uncle Sáu, the water-carrier. The market inside the walls.' }],
      talk: [
        { say: 'Tea? No. I would sweat it all out by noon.' },
        { say: "Uncle, my brother's in the exam hall. He hasn't eaten.", who: 'me' },
        { say: 'None of them eat. Too frightened to swallow.' },
        { say: 'My back is bad today. These buckets...' },
        {
          choose: [
            {
              label: "I'll carry one to the gate for you.",
              set: ['carried'],
              then: [
                { say: 'Then I carry your rice. Fair trade.' },
                { think: 'The bucket weighs as much as a small child.' },
              ],
            },
            {
              label: "I'll pay you. Name it.",
              set: ['paid'],
              then: [
                { say: 'Keep your coins. Bring me a cup of tea at dusk.' },
                { say: 'Old men like to be waited for.' },
              ],
            },
          ],
        },
        { say: 'Which one is he?' },
        { say: 'Thin. Serious. Ears like jug handles.', who: 'me' },
        { say: 'Ah. That narrows it down to all of them.' },
      ],
    },
    {
      id: 'moat',
      hour: 14,
      at: 'moat',
      with: 'dong',
      aim: [{ text: 'Nothing to do but wait. The moat is cool at this hour.' }],
      talk: [
        { think: 'An old man sits by the moat with an old brush case.' },
        { say: 'Waiting for someone inside?' },
        { say: 'My brother. His first time.', who: 'me' },
        { say: 'I sat it five times. Five springs.' },
        { say: 'Never passed. My wife stopped asking in the third year.' },
        {
          choose: [
            {
              label: 'Why did you keep trying?',
              set: ['askedDong'],
              then: [
                { say: 'The walk in at dawn. The quiet in the hall.' },
                { say: 'And her rice, waiting when I came out.' },
                { say: 'It was never the exam I loved. It was coming home.' },
              ],
            },
            {
              label: "He'll pass. He's clever.",
              set: ['sure'],
              then: [
                { say: 'They are all clever. Some are also lucky.' },
                { say: "Pass or fail, feed him. That's the whole trick." },
              ],
            },
          ],
        },
        { say: 'They let them out at dusk. The south gate of the halls.' },
      ],
    },
    {
      id: 'halls',
      hour: 17.5,
      at: 'halls',
      with: 'khoi',
      aim: [{ text: 'They come out at dusk, by the south gate of the halls.' }],
      talk: [
        { think: 'The gate opens. Young men come out, blinking like owls.' },
        { say: 'Lài? You waited all day?' },
        { say: "Someone passed me rice at noon. In Má's leaf." },
        { say: "I cried into it. Don't tell anyone." },
        {
          choose: [
            {
              label: 'How did it go?',
              set: ['askedExam'],
              then: [
                { say: "I don't know. I wrote everything I knew." },
                { say: "Then I wrote some things I didn't." },
                { say: "Good. That's how Má cooks.", who: 'me' },
              ],
            },
            {
              label: "Don't tell me yet. Tea first.",
              set: ['teaFirst'],
              then: [
                { think: 'He drinks it with both hands, like when he was small.' },
                { say: '...Thank you.' },
              ],
            },
          ],
        },
        {
          when: ['paid'],
          then: [
            { think: 'Uncle Sáu is waiting by the water tank. For his tea.' },
            { say: 'One more cup, Khôi. I owe a man.', who: 'me' },
          ],
        },
      ],
    },
    {
      id: 'home',
      hour: 19.6,
      at: 'home',
      with: 'ma',
      aim: [{ text: 'Home. Má will ask one thing, and only one.' }],
      talk: [
        { say: 'Well? Did he eat?' },
        {
          when: ['promised'],
          then: [{ say: 'He ate, Má. I promised.', who: 'me' }, { say: 'Good. Then the rest is up to the sky.' }],
          otherwise: [
            { say: 'He ate. Somebody helped.', who: 'me' },
            { say: 'There is always somebody. Remember to be them.' },
          ],
        },
        { say: "Má, I don't know if I passed.", who: 'khoi' },
        { say: 'Did I ask you that? Sit. Eat.' },
        {
          choose: [
            {
              label: 'Tell them about the old scholar.',
              set: ['toldDong'],
              then: [
                { say: 'A man by the moat sat it five times.', who: 'me' },
                { say: 'Five? And he can still walk?' },
                { say: 'He said the best part was coming home.', who: 'me' },
                { say: 'It is.', who: 'khoi' },
              ],
            },
            {
              label: 'Say nothing. Just eat.',
              set: ['quiet'],
              then: [
                { think: 'The rice is too salty. Nobody says so.' },
                { think: 'Khôi falls asleep sitting up. Má covers him.' },
              ],
            },
          ],
        },
        {
          when: ['fedCat'],
          then: [{ think: 'The grey cat from the gate is on the step. It followed the rice.' }],
        },
      ],
    },
  ],
  close: [
    { when: ['toldDong'], text: 'Pass or fail, he came home. That is the whole trick.' },
    { when: ['askedDong'], text: 'Pass or fail, he came home. That is the whole trick.' },
    { text: 'Tomorrow they post the names. Tonight there is rice.' },
  ],
};
