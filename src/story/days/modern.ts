import type { Beat, DayScript } from '@/story/script';

/**
 * 2020. Minh works at a print shop downtown and lives alone on the edge of
 * town. Their mother has called three times since Sunday, when they argued,
 * and Minh has not called back.
 */

/** The call, whenever it is answered. */
const THE_CALL: readonly Beat[] = [
  { say: 'Minh? I only wanted to know you ate.', who: 'mum' },
  {
    when: ['twoRolls'],
    then: [{ say: 'Twice, Mum. Chú Ba says hello.', who: 'me' }],
    otherwise: [{ say: 'I ate, Mum.', who: 'me' }],
  },
  { say: "Good. That's all. That's all I wanted.", who: 'mum' },
  { say: "Mum... I'm sorry about Sunday.", who: 'me' },
  { say: 'Sunday? I forgot Sunday. Come home for Tết.', who: 'mum' },
];

export const MODERN_DAY: DayScript = {
  era: 'modern',
  title: 'Four missed calls',
  me: { name: 'Minh', age: 29 },
  places: {
    home: { kind: 'home', reach: [0.5, 0.88] },
    corner: { kind: 'market', from: 'home', minM: 50, maxM: 200 },
    work: { kind: 'work', from: 'corner', minM: 120, maxM: 380, reach: [0, 0.5] },
    park: { kind: 'park', from: 'work', minM: 40, maxM: 220 },
    shore: { kind: 'shore', from: 'work', minM: 60, maxM: 460 },
  },
  cast: {
    tu: { name: 'Bà Tư', clothes: 0x9a6a86 },
    ba: { name: 'Chú Ba', clothes: 0xd8c8a8 },
    hanh: { name: 'Chị Hạnh', clothes: 0x3a3a48 },
    hai: { name: 'Ông Hai', clothes: 0x7a8a6a },
    mum: { name: 'Mum', clothes: 0, kind: 'voice' },
    cat: { name: 'Cat', clothes: 0x8a8a8a, kind: 'cat' },
  },
  scenes: [
    {
      id: 'morning',
      hour: 6.8,
      at: 'home',
      with: 'tu',
      aim: [{ text: 'Out of the door before the day notices me.' }],
      talk: [
        { think: 'Three missed calls from Mum. Since Sunday.' },
        { think: 'We argued about Tết. Or about my job. Both, really.' },
        { think: "I'll call her back. When I know what to say." },
        { say: 'Minh! Strong young back. Come here.' },
        { say: 'The water man left my jug at the gate. Again.' },
        {
          choose: [
            {
              label: 'Carry it up for her.',
              set: ['helpedTu'],
              then: [
                { say: 'My grandson calls on Sundays. From Đà Lạt.' },
                { say: "He talks about the weather. I don't care. I listen." },
                { think: 'The jug is heavier than it looks. So is that.' },
              ],
            },
            {
              label: "Sorry, Bà. I'm late already.",
              set: ['rushed'],
              then: [{ say: 'Go, go. Young people are always late.' }, { say: 'Late for what, I never know.' }],
            },
          ],
        },
      ],
    },
    {
      id: 'corner',
      hour: 7.5,
      at: 'corner',
      with: 'ba',
      aim: [{ text: 'Bread and coffee at the corner. Chú Ba will have it ready.' }],
      extras: [
        {
          who: 'cat',
          at: 'corner',
          offset: [-3.2, 1.6],
          talk: [
            { think: 'A grey cat with one white paw sits under the cart.' },
            {
              choose: [
                {
                  label: 'Share a bit of pâté with it.',
                  set: ['fedCat'],
                  then: [{ think: 'It eats, then washes, then ignores me. Perfect.' }],
                },
                { label: 'Leave it be.', then: [{ think: 'It has the look of a cat with a pension.' }] },
              ],
            },
          ],
        },
      ],
      talk: [
        { say: 'The usual? Extra chilli, no coriander.' },
        { say: 'You remember everything, Chú Ba.', who: 'me' },
        { say: 'Twelve years on this corner. I know every order.' },
        { say: 'Your mother came by once. Before you moved in.' },
        { say: 'She did?', who: 'me' },
        { say: 'Asked me to make sure you eat. Eat first, worry after.' },
        {
          choose: [
            { label: 'Two rolls. One for later.', set: ['twoRolls'], then: [{ say: 'Good. Two is a plan.' }] },
            {
              label: 'Just coffee today.',
              set: ['noBread'],
              then: [{ say: "Coffee isn't breakfast. Tell your mother I tried." }],
            },
          ],
        },
      ],
    },
    {
      id: 'work',
      hour: 8.4,
      at: 'work',
      with: 'hanh',
      aim: [{ text: "The print shop. Chị Hạnh hates it when I'm late." }],
      talk: [
        {
          when: ['helpedTu'],
          then: [
            { say: 'Ten minutes late. You look like you carried a fridge.' },
            { say: 'A water jug.', who: 'me' },
            { say: 'Close enough.' },
          ],
          otherwise: [{ say: 'On time. Is it your birthday?' }],
        },
        { say: 'Wedding cards for Friday. Four hundred of them.' },
        { say: 'The printer jammed again. Can you stay tonight?' },
        {
          choose: [
            {
              label: "I'll stay. We'll finish them.",
              set: ['stayLate'],
              then: [{ say: "You're a good one. I'll buy dinner." }, { think: 'Dinner will be rice from a box, at nine.' }],
            },
            {
              label: 'Not tonight. I have a call to make.',
              set: ['leaveOnTime'],
              then: [
                { say: 'A call? Must be important.' },
                { say: "It's my mum.", who: 'me' },
                { say: 'Oh. Then go at six. Sharp. Go.' },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'lunch',
      hour: 12.2,
      at: 'park',
      with: 'hai',
      aim: [{ text: 'Lunch in the park. Quiet, if the pigeons allow it.' }],
      talk: [
        { say: "Sit, sit. They don't bite. Much." },
        { say: 'My son calls every Sunday at eight.' },
        { say: 'Twenty years. Mostly he says nothing.' },
        { say: 'The weather. His dog. What he had for lunch.' },
        {
          choose: [
            {
              label: "Doesn't that bore you?",
              set: ['askedHai'],
              then: [
                { say: "Bore me? It's the best hour of my week." },
                { say: "I don't need the news. I need the voice." },
                { think: 'Three missed calls. Three voices.' },
              ],
            },
            {
              label: "My mum calls. I don't pick up.",
              set: ['toldHai'],
              then: [
                { say: 'Ah. Too much to say, or nothing to say?' },
                { say: 'Both.', who: 'me' },
                { say: "Then say nothing. She'll do the talking." },
              ],
            },
          ],
        },
        {
          when: ['twoRolls'],
          then: [
            { say: 'Have my other roll. Chú Ba made it.', who: 'me' },
            { say: 'Extra chilli? Bless you. And him.' },
          ],
        },
      ],
    },
    {
      id: 'late',
      hour: 19,
      when: ['stayLate'],
      at: 'work',
      with: 'hanh',
      aim: [{ text: 'Back to the jammed printer. Four hundred cards.' }],
      talk: [
        { say: 'Last box. You are a hero. Dinner is on me.' },
        { think: 'The phone buzzes. Mum. The fourth time.' },
        {
          choose: [
            { label: 'Answer it. Here, now.', set: ['answered'], then: THE_CALL },
            {
              label: 'Let it ring. Call her from home.',
              set: ['later'],
              then: [
                { think: 'The buzzing stops. The shop is very quiet.' },
                { say: 'Your mother? Go home, Minh. I can finish.' },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'water',
      hour: 18.3,
      when: ['leaveOnTime'],
      at: 'shore',
      aim: [{ text: 'Out at six. The long way home, by the water.' }],
      talk: [
        { think: 'The water is doing its evening thing. Pink, then grey.' },
        { think: 'The phone. Mum. Before I know what to say.' },
        {
          choose: [
            { label: 'Answer.', set: ['answered'], then: THE_CALL },
            {
              label: 'Let it ring. Call her from home.',
              set: ['later'],
              then: [{ think: 'The phone stops. The water keeps going.' }],
            },
          ],
        },
      ],
    },
    {
      id: 'night',
      hour: 21,
      at: 'home',
      aim: [{ text: 'Home. The flat is small, and it is mine.' }],
      talk: [
        {
          when: ['later'],
          then: [
            { think: 'Home. The phone in my hand. Four missed calls.' },
            {
              choose: [
                {
                  label: 'Call her now.',
                  set: ['calledBack'],
                  then: [
                    { say: 'Minh! Is something wrong?', who: 'mum' },
                    { say: 'No. I just wanted to hear you.', who: 'me' },
                    { say: 'Oh. Well. It rained here today...', who: 'mum' },
                    { think: 'She tells me all about the rain. I listen to all of it.' },
                  ],
                },
                {
                  label: 'Tomorrow. First thing.',
                  set: ['tomorrow'],
                  then: [{ think: 'I set an alarm and call it MUM.' }],
                },
              ],
            },
          ],
        },
        { when: ['helpedTu'], then: [{ think: 'A covered plate on my step. A note: EAT. Bà Tư.' }] },
        { when: ['fedCat'], then: [{ think: "A grey cat on the wall outside. It can't be the same one." }] },
        { think: 'Across the street, all the lit windows. Everyone with a phone.' },
      ],
    },
  ],
  close: [
    { when: ['answered'], text: 'She talked about the weather. It was the best part.' },
    { when: ['calledBack'], text: 'She talked about the rain. It was the best part.' },
    { text: 'Tomorrow, first thing. I mean it this time.' },
  ],
};
