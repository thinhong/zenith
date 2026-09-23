import type { Role } from '@/agents/schedule';
import type { LotUse } from '@/world/lots';

/**
 * What people are thinking. Data only, no logic (PLAN.md 4.2).
 *
 * The rules are in PLAN.md 7 and they matter more than the count: first person,
 * present tense, plain words, under 60 characters. A mix of work, money, love,
 * health, food, small errands, hopes and small kindnesses. About one in ten is
 * light, about one in ten is tender. Nothing mocking, no politics, no brands,
 * no real people. These people are trying as hard as the viewer is.
 *
 * Era flavour comes from the nouns, not from old-fashioned grammar. Modern
 * Vietnam: the report, the scooter payment, the grant deadline, the rent.
 */
export type ThoughtPlace = Exclude<LotUse, 'water'> | 'street';

export const THOUGHT_PLACES: readonly ThoughtPlace[] = [
  'home',
  'work',
  'market',
  'temple',
  'park',
  'street',
];

/**
 * The parts of the day a thought can belong to. Five, because that is how
 * people divide a day without a clock: getting up, the working morning, the
 * slow afternoon, coming home, and the hours when everyone else is asleep.
 */
export type TimeOfDay = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';

export const TIMES_OF_DAY: readonly TimeOfDay[] = ['dawn', 'morning', 'afternoon', 'evening', 'night'];

/** Which part of the day an hour falls in. */
export function timeOfDay(hour: number): TimeOfDay {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

/**
 * Everything one era, or the shared human core, has to say.
 *
 * A thought used to depend on where a person was standing and nothing else,
 * so a student and a grandmother at the same market stall had the same forty
 * lines between them, and noon sounded like midnight. Now a line can belong to
 * a place, to a kind of person, or to a time of day, and a person draws from
 * all three at once. What somebody is thinking fits who they are and when it
 * is, as well as where they happen to be.
 */
export type ThoughtSet = Readonly<Record<ThoughtPlace, readonly string[]>> & {
  /** Lines for one kind of person, wherever they are. */
  readonly byRole?: Readonly<Partial<Record<Role, readonly string[]>>>;
  /** Lines for one part of the day, whoever and wherever. */
  readonly byTime?: Readonly<Partial<Record<TimeOfDay, readonly string[]>>>;
};

/** Who is thinking, where, and when. */
export interface ThoughtContext {
  place: ThoughtPlace;
  role: Role;
  time: TimeOfDay;
}

export const MODERN_THOUGHTS: ThoughtSet = {
  home: [
    'The rent is due on Friday.',
    'I should call my mother.',
    'Did I lock the door?',
    'The fan is making that noise again.',
    'One more year, then I rest.',
    'She still has not texted back.',
    'I will start running tomorrow.',
    'My son grew out of his shoes again.',
    'The rice is nearly finished.',
    'I hope she gets in.',
    'I miss the house I grew up in.',
    'Tonight I will sleep early. Really.',
    'The wifi is down. We will have to talk.',
    'Who used all the hot water?',
    'The landlord wants to sell the building.',
    'Tết is coming. So is the cleaning.',
    'My mother keeps asking about grandchildren.',
    'I will fix the fan this weekend.',
  ],
  work: [
    'The report is due at four.',
    'I asked for the raise. Now I wait.',
    'Two more years and I can leave.',
    'He took the credit again.',
    'I do not understand this spreadsheet.',
    'Nobody read the email.',
    'The deadline moved. Of course it did.',
    'I am good at this. I think.',
    'My back hurts from this chair.',
    'If I finish early I can see her.',
    'The new one is quick. Good.',
    'I should have studied something else.',
    'One more coffee and I can think.',
    'Is this what I wanted at twenty?',
    'The client wants it yesterday.',
    'I am in six group chats for one project.',
    'Performance review. Deep breath.',
    'The lift is broken. Nine floors.',
    'I asked a question. Now it is my job.',
    'The new manager is younger than me.',
  ],
  market: [
    'Pork has gone up again.',
    'She always gives me the good bunch.',
    'I forgot what I came for.',
    'Enough for three days.',
    'My daughter hates fish. I buy it anyway.',
    'Cheaper at the other stall, but further.',
    'I will cook properly tonight.',
    'The mangoes are early this year.',
    'He is short today. I will say nothing.',
    'A little more and it is mine.',
    'I always buy too much.',
    'Her son is taller than me now.',
    'Is that fresh or from yesterday?',
    'The supermarket is cheaper. This is better.',
    'Tết prices already, and it is only October.',
    'She gave me an extra bunch of herbs.',
    'My scooter is parked right in the way.',
    'Bargain for the fish. Never the flowers.',
  ],
  temple: [
    'I am not asking for much.',
    'Let her be well.',
    'I come here when I cannot think.',
    'My grandmother taught me this.',
    'I do not know if anyone hears.',
    'Let the results come out right.',
    'I will try to be kinder.',
    'The incense smells like childhood.',
    'Thank you. Just thank you.',
    'Let him get home safely.',
    'Let the exam go well for my son.',
    'Bless the new shop. Please.',
    'I burn paper money for my father.',
    'The first of the month. I always come.',
    'Let the scan be clear. Please.',
    'I asked for a good husband. Still asking.',
  ],
  park: [
    'It is cooler under this tree.',
    'Five more minutes.',
    'The old man is here every morning.',
    'I forgot how quiet it can be.',
    'My knees are not what they were.',
    'That child will fall. No, she is fine.',
    'I will sit until the light changes.',
    'He said he would come.',
    'The birds do not care about any of this.',
    'I should do this more often.',
    'Nothing is wrong. That is strange.',
    'Everyone is doing exercises but me.',
    'The shuttlecock is in the tree again.',
    'A wedding photo shoot. I miss my wedding day.',
    'Nobody is on their phone here. Mostly.',
    'The fountain is working. My son will be happy.',
    'I bought a sugarcane juice. Worth it.',
  ],
  street: [
    'The scooter payment is due Friday.',
    'I am late. I am always late.',
    'It will rain before I get there.',
    'My helmet strap is loose.',
    'I should have left ten minutes earlier.',
    'This road is worse every month.',
    'I will eat something after this.',
    'Did I turn off the stove?',
    'She looked happy. Good for her.',
    'Just get through today.',
    'The grant deadline is Monday.',
    'I want to go home and lie down.',
    'One day I will drive this road for fun.',
    'That dog has the right idea.',
    'The rain is coming sideways. Of course.',
    'Honk, honk, honk. Every single day.',
    'I left my raincoat under the seat.',
    'The road is flooded to the knee.',
    'Parking costs more than lunch.',
    'A taxi would be faster. And dearer.',
  ],

  byRole: {
    office: [
      'The meeting could have been an email.',
      'My boss replied at midnight again.',
      'Overtime again. The kids will be asleep.',
      'I have forty unread messages. Forty.',
      'The air conditioning is too cold in here.',
      'I nodded in the meeting. I was not listening.',
      'The promotion list comes out Friday.',
      'I will eat lunch at my desk again.',
      'The printer is broken. Of course it is.',
      'Nobody has replied. Is that good?',
    ],
    shop: [
      'Three people asked the price and left.',
      'The landlord put the rent up again.',
      'Everyone buys online now. What do I sell?',
      'I should put the prices on the board.',
      'My daughter says I need a page online.',
      'The big shop down the road has it cheaper.',
      'Sold out by ten. Should have bought more.',
      'I have not had a day off since Tết.',
      'She paid by phone. I still like cash.',
      'Rain means nobody stops. Rain again.',
    ],
    student: [
      'The entrance exam is in six months.',
      'My parents want medicine. I want music.',
      'Tuition is due and I have not told them.',
      'Three hours of extra class after school.',
      'She liked my photo. What does it mean?',
      'I stayed up studying and remember nothing.',
      'Everyone else has a scooter already.',
      'I want to study abroad. They will say no.',
      'The group chat has gone quiet. Uh oh.',
      'If I get in, everything changes.',
    ],
    retired: [
      'My son calls on Sundays. Mostly.',
      'The grandchildren only look at their phones.',
      'I remember when this was all rice fields.',
      'Tai chi in the park at five. Every day.',
      'My pension is small, but it is mine.',
      'The doctor says less salt. Hah.',
      'Everyone is on a screen. Nobody talks.',
      'I taught school for thirty years.',
      'The new flats block my view of the river.',
      'I bought a phone. I cannot work it.',
    ],
    night: [
      'Night shift again. The café opens at six.',
      'The security desk is freezing at three.',
      'Nobody is on the road. I love that.',
      'I drive the night bus. Nobody talks to me.',
      'The factory hums all night. So do I.',
      "I sleep through my children's mornings.",
      'Night pay is better. My body disagrees.',
      'The noodle stall is my only friend.',
      'Everyone else is scrolling. I am working.',
      'Two more shifts and I have a day off.',
    ],
  },

  byTime: {
    dawn: [
      'The first scooters are out. I should go.',
      'Alarm, snooze, alarm, snooze.',
      'Coffee first. Everything else second.',
      'The wet market is loudest at this hour.',
      'The traffic has not started. Go now.',
      'The old men are already at the park.',
      'I should run. I will not run.',
      'The noodle stall is setting up. Good.',
    ],
    morning: [
      'Rush hour. Every road is a car park.',
      'I am late for the meeting at nine.',
      'Iced coffee. The only way to start.',
      'My inbox is full before I sit down.',
      'The school run is chaos, as always.',
      'Rain in the morning means floods by noon.',
      'The bank opens at eight. I am there at eight.',
      'The traffic lights are out. I will be late.',
    ],
    afternoon: [
      'The afternoon meeting. Stay awake.',
      'Too hot to think. Too hot to move.',
      'The storm comes at three, every day.',
      'One more coffee and I will get through.',
      'Lunch was noodles. Dinner will be noodles.',
      'My phone is dying and so am I.',
      'The kids are out of school. Chaos.',
      'I should leave early. I will not.',
    ],
    evening: [
      'The traffic home is the worst part.',
      'Rice, fish, and the news. Every night.',
      'I will cook. No, we will order in.',
      'The café on the corner is full again.',
      'Everyone is on their balcony. Me too.',
      'Karaoke next door. Here we go.',
      'Sunset over the river. Worth the jam.',
      'Homework at the table. Tears, probably.',
    ],
    night: [
      'One more episode. Then sleep.',
      'I am scrolling and I do not know why.',
      'The neighbours are singing. I know the words.',
      'Is the gas off? I will check.',
      'Tomorrow I will not look at my phone.',
      'The air conditioner is dripping again.',
      'Still no reply. It is late. Let it go.',
      'The motorbikes have finally stopped.',
    ],
  },
};

/** Longest a thought may be, so the pill stays one short line (PLAN.md 7). */
export const MAX_THOUGHT_LENGTH = 60;

/** A person standing somewhere with no thoughts of its own falls back to the street. */
export function thoughtsFor(set: ThoughtSet, place: ThoughtPlace): readonly string[] {
  const list = set[place];
  return list.length > 0 ? list : set.street;
}

const pools = new WeakMap<ThoughtSet, WeakMap<ThoughtSet, Map<string, readonly string[]>>>();

/**
 * Every line a person in this context might think: their era's lines for the
 * place, the role and the time of day, then the shared human core's lines for
 * the same three.
 *
 * The core is what makes the piece's idea structural rather than a few lines
 * copied between files. Every era draws on exactly the same human worries
 * underneath its own nouns, so a clerk in 1800 and a clerk in 2300 really are
 * picking from one list with different clothes on.
 *
 * Built once per context and kept: there are 150 contexts per era, and a pick
 * happens only when a new person starts thinking, never per frame.
 */
export function thoughtPool(
  era: ThoughtSet,
  context: ThoughtContext,
  core?: ThoughtSet,
): readonly string[] {
  const key = `${context.place}|${context.role}|${context.time}`;
  const coreKey = core ?? era;
  let byCore = pools.get(era);
  if (!byCore) {
    byCore = new WeakMap();
    pools.set(era, byCore);
  }
  let cache = byCore.get(coreKey);
  if (!cache) {
    cache = new Map();
    byCore.set(coreKey, cache);
  }
  const known = cache.get(key);
  if (known) return known;

  const pool: string[] = [];
  const seen = new Set<string>();
  const add = (lines: readonly string[] | undefined): void => {
    if (!lines) return;
    for (const line of lines) {
      // A line in both the era and the core would be picked twice as often
      // as its neighbours. Once is enough.
      if (seen.has(line)) continue;
      seen.add(line);
      pool.push(line);
    }
  };
  for (const set of core ? [era, core] : [era]) {
    add(thoughtsFor(set, context.place));
    add(set.byRole?.[context.role]);
    add(set.byTime?.[context.time]);
  }
  cache.set(key, pool);
  return pool;
}
