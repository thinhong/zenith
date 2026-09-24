import type { DayScript } from '@/story/script';

/**
 * Wyrmrest. Edda bakes her mother's bread in her mother's ovens, and it is
 * never quite right. Her brother wants her to sell the ovens and rest. She
 * has promised him an answer by supper.
 */
export const WYRMREST_DAY: DayScript = {
  era: 'myth',
  title: "Edda's bread",
  me: { name: 'Edda', age: 34 },
  places: {
    home: { kind: 'home', reach: [0.35, 0.82] },
    market: { kind: 'market', from: 'home', minM: 60, maxM: 240 },
    gate: { kind: 'landmark', landmark: 'southGate' },
    green: { kind: 'park', big: true, from: 'gate', minM: 50, maxM: 280 },
    temple: { kind: 'temple', from: 'green', minM: 50, maxM: 300 },
  },
  cast: {
    cat: { name: 'Cat', clothes: 0x8a8a8a, kind: 'cat' },
    maud: { name: 'Maud', clothes: 0x7a6a8a },
    tam: { name: 'Tam', clothes: 0x5f7486 },
    ivo: { name: 'Ivo', clothes: 0x8a5a44 },
    wystan: { name: 'Brother Wystan', clothes: 0x5a5048 },
  },
  scenes: [
    {
      id: 'dawn',
      hour: 5.3,
      at: 'home',
      aim: [{ text: 'Bread first. Then the rest of it.' }],
      talk: [
        { think: "Loaves out. Mum's recipe. My hands." },
        { think: 'Tam wants his answer by supper.' },
        { think: 'Sell the ovens, or keep them. Bread first.' },
      ],
    },
    {
      id: 'market',
      hour: 7,
      at: 'market',
      with: 'maud',
      aim: [{ text: 'Maud takes the first loaves. The market.' }],
      extras: [
        {
          who: 'cat',
          at: 'home',
          offset: [2.4, 0.8],
          talk: [
            { think: 'A grey cat with one white paw. Watching the bread.' },
            {
              choose: [
                { label: 'Give it a crust.', set: ['fedCat'], then: [{ think: 'It eats like it has somewhere to be.' }] },
                { label: 'Not today, puss.', then: [{ think: 'It watches you go. Not offended. Not fooled.' }] },
              ],
            },
          ],
        },
      ],
      talk: [
        { say: "There she is. Is this your bread or your mum's?" },
        { say: "It's all mine now, Maud.", who: 'me' },
        { think: 'She tears off a corner and chews for a long time.' },
        { say: 'Good crust. Not hers, though. Is it.' },
        {
          choose: [
            {
              label: 'No. I can never get it right.',
              set: ['honest'],
              then: [
                { say: "She couldn't either, love. Burnt half of it." },
                { say: 'We bought it for her, not for the bread.' },
                { think: 'Nobody ever told me that.' },
              ],
            },
            {
              label: 'Same flour. Same oven.',
              set: ['proud'],
              then: [
                { say: "Then it's the hands. Hands take years." },
                { think: 'Everyone in town is an expert on my hands.' },
              ],
            },
          ],
        },
        { say: 'Take your brother his loaf. South gate, he said.' },
      ],
    },
    {
      id: 'gate',
      hour: 11.3,
      at: 'gate',
      with: 'tam',
      aim: [{ text: "Tam's on the south gate. He'll want feeding." }],
      talk: [
        { say: 'Is that for me, or are you selling it?' },
        { say: 'For you. Free. Once.', who: 'me' },
        { think: 'He eats half of it before he says anything else.' },
        { say: 'So. Have you thought about it?' },
        {
          choose: [
            {
              label: 'Why do you want me to sell?',
              set: ['asked'],
              then: [
                { say: 'Because you get up at three.' },
                { say: 'Mum got up at three for forty years.' },
                { say: "I don't want the ovens gone. I want you back." },
                { think: "He's been saying that to the gate all morning." },
              ],
            },
            {
              label: 'Stop asking. I said supper.',
              set: ['snapped'],
              then: [
                { say: 'Fine. Supper.' },
                { say: 'Bring the burnt ones. I like those.' },
                { think: "He's trying. So am I. We're both bad at it." },
              ],
            },
          ],
        },
        { say: 'Go and sit on the green a while. You never sit.' },
      ],
    },
    {
      id: 'green',
      hour: 14.4,
      at: 'green',
      with: 'ivo',
      aim: [{ text: 'The green. Somewhere to sit that is not a sack of flour.' }],
      talk: [
        { think: 'A young man sits by the well. Sword, bandage, no pride left.' },
        { say: 'Is that bread? Real bread?' },
        { say: "It's the last loaf. It's for supper.", who: 'me' },
        { say: 'The boar won. I have nothing to pay you with.' },
        { say: "I'm not begging. I'm only very hungry." },
        {
          choose: [
            {
              label: 'Have it. Supper can be soup.',
              set: ['gaveLoaf'],
              then: [
                { think: 'He eats it the way people pray.' },
                { say: "That's like my gran's. She burnt the bottoms." },
                { say: 'Best bread I ever had. Hers, I mean. And this.' },
              ],
            },
            {
              label: "Sorry. It's my brother's supper.",
              set: ['keptLoaf'],
              then: [
                { say: "No, you're right. Family first." },
                { say: "I'll beat that boar tomorrow. Then I'll pay you." },
                { think: 'I feel it all the way down the lane.' },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'temple',
      hour: 17.4,
      at: 'temple',
      with: 'wystan',
      aim: [{ text: "Mum's stone is round the back of the temple. Nobody sweeps it." }],
      talk: [
        { say: "Edda. You're late this week." },
        { say: 'Busy week. Busy year.', who: 'me' },
        { say: 'She used to bring me the burnt ones.' },
        { say: 'Said I was the only man in town who would eat them.' },
        {
          choose: [
            {
              label: "Tell her about Tam's offer.",
              set: ['toldMum'],
              then: [
                { think: 'Tam wants to sell, Mum. He might be right.' },
                { think: 'The wind says nothing useful.' },
              ],
            },
            {
              label: "Tell her the bread's not right.",
              set: ['toldBread'],
              then: [
                { think: "It's not right, Mum. I've tried everything." },
                { think: 'A crow lands on the stone and looks at me.' },
              ],
            },
          ],
        },
        { say: 'She would tell you: eat first, worry after.' },
        { say: 'Go home. Your brother is already walking that way.' },
      ],
    },
    {
      id: 'supper',
      hour: 20,
      at: 'home',
      with: 'tam',
      aim: [{ text: 'Home. Supper. Tam. The answer.' }],
      talk: [
        { say: 'It still smells like her in here.' },
        {
          when: ['gaveLoaf'],
          then: [
            { say: 'No bread tonight. I gave it to a hero.', who: 'me' },
            { say: 'Of course you did. She would have.' },
          ],
          otherwise: [{ think: 'He breaks the loaf and checks the bottom.' }, { say: 'Burnt. Good.' }],
        },
        { say: 'So. The ovens.' },
        {
          choose: [
            {
              label: "I'm keeping them.",
              set: ['keep'],
              then: [
                {
                  when: ['asked'],
                  then: [
                    { say: "Then I'm kneading on rest days. Don't argue." },
                    { say: "You'll ruin it.", who: 'me' },
                    { say: 'Probably. She ruined half of hers.' },
                  ],
                  otherwise: [
                    { say: 'All right. Then sleep past three, now and then.' },
                    { say: 'Past four. Maybe.', who: 'me' },
                  ],
                },
              ],
            },
            {
              label: "Sell them. I'm tired, Tam.",
              set: ['sell'],
              then: [
                {
                  when: ['asked'],
                  then: [
                    { say: "I'll tell Fenn tomorrow. You'll still bake for us?" },
                    { say: 'On rest days.', who: 'me' },
                    { say: 'Burnt, please.' },
                  ],
                  otherwise: [
                    { say: 'You are sure?' },
                    { say: "No. But I'm tired of being sure.", who: 'me' },
                  ],
                },
              ],
            },
          ],
        },
        {
          when: ['fedCat'],
          then: [{ think: 'The grey cat is asleep on the warm oven. Nobody moves it.' }],
        },
      ],
    },
  ],
  close: [
    { when: ['keep'], text: "It's not her bread. It's mine. That will have to do." },
    { text: 'Tomorrow I wake at seven. I have no idea how.' },
  ],
};
