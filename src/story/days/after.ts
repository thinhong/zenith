import type { DayScript } from '@/story/script';

/**
 * 2300. Sol has tended the lindens on one street by hand for forty-one
 * years. From tomorrow the machines take the street. They are good machines,
 * and that is the trouble.
 */
export const AFTER_DAY: DayScript = {
  era: 'after',
  title: 'Linden Row',
  me: { name: 'Sol', age: 71 },
  places: {
    home: { kind: 'home', reach: [0.45, 0.85] },
    row: { kind: 'park', from: 'home', minM: 40, maxM: 210 },
    depot: { kind: 'work', from: 'row', minM: 100, maxM: 330 },
    spire: { kind: 'landmark', landmark: 'spire' },
    old: { kind: 'park', big: true, from: 'spire', minM: 80, maxM: 330 },
  },
  cast: {
    ada: { name: 'Ada', clothes: 0x5e9486 },
    unit: { name: 'Tender Seven', clothes: 0xe4e8ec, kind: 'machine' },
    kofi: { name: 'Kofi', clothes: 0xe0a040, scale: 0.72 },
    cat: { name: 'Bin', clothes: 0x8a8a8a, kind: 'cat' },
  },
  scenes: [
    {
      id: 'morning',
      hour: 6,
      at: 'home',
      aim: [{ text: 'Linden Row. Water the lindens, one last time.' }],
      talk: [
        { think: 'Last day on Linden Row. Tomorrow, the machines.' },
        { think: "They're good machines. That's the trouble." },
        { think: "Ada will be at the trees already. She's always early." },
      ],
    },
    {
      id: 'row',
      hour: 6.7,
      at: 'row',
      with: 'ada',
      aim: [{ text: "Linden Row. Ada will say I'm late." }],
      talk: [
        { say: 'You are late. The lindens are complaining.' },
        { say: "Trees don't complain. They sulk.", who: 'me' },
        { say: 'Why do you touch the bark before you water?' },
        {
          choose: [
            {
              label: "To see if it's thirsty.",
              set: ['taughtBark'],
              then: [
                { say: 'Cold bark, thirsty tree. Warm bark, leave it be.', who: 'me' },
                { say: 'The sensors do that.' },
                { say: "The sensors don't say good morning.", who: 'me' },
              ],
            },
            {
              label: 'Habit. Old men have habits.',
              set: ['shrugged'],
              then: [
                { say: 'Teach me the habit, then.' },
                { say: 'Hand on the bark. Say good morning. Water.', who: 'me' },
                { say: 'Good morning, tree.' },
                { think: 'It is the most serious I have ever seen her.' },
              ],
            },
          ],
        },
        { say: 'They want your key back at the depot. I heard.' },
      ],
    },
    {
      id: 'depot',
      hour: 10,
      at: 'depot',
      with: 'unit',
      aim: [{ text: 'The depot. They want my key back.' }],
      talk: [
        { say: 'Good morning, Sol. I am to take Linden Row.' },
        { say: 'I have read your logs. Forty-one years.' },
        { say: 'One question. How do you know a tree is thirsty?' },
        {
          choose: [
            {
              label: 'Put your hand on the bark.',
              set: ['toldUnit'],
              then: [
                { say: 'I have no hands. I have a probe.' },
                { say: 'Then put your probe on it. Kindly.', who: 'me' },
                { say: 'I will try kindly. I will log the result.' },
              ],
            },
            {
              label: "You'll work it out.",
              set: ['keptSecret'],
              then: [
                { say: 'Yes. It will take me some years.' },
                { say: 'It took you some years.' },
                { think: "It's right. It's annoying when they're right." },
              ],
            },
          ],
        },
        { say: 'Your key, please. Thank you for the trees.' },
        { think: 'Forty-one years, and the key is lighter than I remember.' },
      ],
    },
    {
      id: 'spire',
      hour: 13,
      at: 'spire',
      with: 'kofi',
      aim: [{ text: 'Lunch under the spire. The fountain is cool there.' }],
      extras: [
        {
          who: 'cat',
          at: 'spire',
          offset: [2.6, 1.8],
          talk: [
            { think: 'A grey cat with one white paw, asleep in the sun.' },
            {
              choose: [
                {
                  label: 'Scratch its ears.',
                  set: ['fedCat'],
                  then: [{ think: 'It purrs like a small engine. An old kind.' }],
                },
                { label: 'Let it sleep.', then: [{ think: 'It opens one eye. Approves. Closes it.' }] },
              ],
            },
          ],
        },
      ],
      talk: [
        { say: 'Are you the tree man? My school said.' },
        { say: 'The tree man. Yes. For today.', who: 'me' },
        { say: 'Why only today?' },
        {
          choose: [
            {
              label: 'Machines do it from tomorrow.',
              set: ['toldKofi'],
              then: [
                { say: "Machines can't climb trees." },
                { say: 'They fly.', who: 'me' },
                { say: "That's cheating." },
              ],
            },
            {
              label: "Because I'm old and tired.",
              set: ['tiredKofi'],
              then: [
                { say: 'My granny is old. She still does her plants.' },
                { say: 'She talks to them. Is that allowed?' },
                { say: "It's required.", who: 'me' },
              ],
            },
          ],
        },
        { say: 'The cat is called Bin. She was here before the trees.' },
      ],
    },
    {
      id: 'planting',
      hour: 17.5,
      at: 'old',
      with: 'ada',
      aim: [{ text: 'One more thing. A seedling for the old park.' }],
      talk: [
        { think: 'One linden seedling. Forty years from shade.' },
        { say: 'You planted all of these?' },
        { say: 'Most. Some planted themselves. Show-offs.', who: 'me' },
        { say: 'Who waters this one, after today?' },
        {
          choose: [
            {
              label: 'You do. By hand.',
              set: ['gaveAda'],
              then: [
                { say: 'The machines would do it better.' },
                { say: "Better isn't the point.", who: 'me' },
                { say: 'Then what is the point?' },
                { say: 'Good morning, tree.', who: 'me' },
              ],
            },
            {
              label: 'The machine. It asked kindly.',
              set: ['gaveUnit'],
              then: [
                { say: 'You trust it?' },
                { say: 'It asked how to be kind. That is a start.', who: 'me' },
                {
                  when: ['keptSecret'],
                  then: [
                    { say: "You didn't tell it about the bark, though." },
                    { say: 'It will work it out. I did.', who: 'me' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'window',
      hour: 20.5,
      at: 'home',
      aim: [{ text: 'Home. The row will be fine. So will I, probably.' }],
      talk: [
        { think: 'From the window you can see the whole of Linden Row.' },
        {
          when: ['gaveAda'],
          then: [
            { think: 'Ada is down there with a watering can. At night.' },
            { think: 'Hand on the bark. I can see it from here.' },
          ],
        },
        { when: ['gaveUnit'], then: [{ think: 'A small light moves along the row. Slowly. Kindly.' }] },
        { when: ['fedCat'], then: [{ think: 'Bin is on my sill. She has never come in before.' }] },
        { think: 'Nobody needs me tomorrow. That is allowed.' },
      ],
    },
  ],
  close: [{ text: "The trees don't know it's my last day. That's a kindness too." }],
};
