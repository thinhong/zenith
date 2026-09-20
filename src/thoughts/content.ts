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

export type ThoughtSet = Readonly<Record<ThoughtPlace, readonly string[]>>;

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
  ],
};

/** Longest a thought may be, so the pill stays one short line (PLAN.md 7). */
export const MAX_THOUGHT_LENGTH = 60;

/** A person standing somewhere with no thoughts of its own falls back to the street. */
export function thoughtsFor(set: ThoughtSet, place: ThoughtPlace): readonly string[] {
  const list = set[place];
  return list.length > 0 ? list : set.street;
}
