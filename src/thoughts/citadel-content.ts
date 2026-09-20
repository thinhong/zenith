import type { ThoughtSet } from '@/thoughts/content';

/**
 * What people worry about in the citadel, about 1800. Same rules as the modern
 * set (PLAN.md 7): first person, present tense, under sixty characters, gentle.
 *
 * The era shows in the nouns and nowhere else: the mandarin's exam, the price
 * of silk, the drum at dawn, the gate that closes at dusk. A clerk worries
 * about his report the way an office worker does, because that is the whole
 * point of the thing.
 */
export const CITADEL_THOUGHTS: ThoughtSet = {
  home: [
    'The roof leaks again when it rains.',
    'My son studies by the lamp until late.',
    'I should visit my mother in the village.',
    'The rice will last until the harvest.',
    'He is too young to marry. She says no.',
    'I will mend the net tonight.',
    'The drum wakes me before I am ready.',
    'One good year. That is all I ask.',
  ],
  work: [
    'The mandarin will read it or he will not.',
    'I have copied this page four times.',
    'My brush is worn down to nothing.',
    'The exam is in the spring.',
    'He passed and I did not.',
    'If I am careful, nobody notices me.',
    'The ledger does not balance. It will.',
    'I know the characters. At the desk I forget.',
    'Twenty years of this and my back is bent.',
  ],
  market: [
    'Silk is dearer than it was last month.',
    'She weighs it light. I say nothing.',
    'Salt, thread, and something sweet.',
    'The fish is not fresh. I will look again.',
    'My daughter wants the blue cloth.',
    'I came for rice and I am still here.',
    'The boats came in late today.',
    'Two coins less and it is a good day.',
    'Her tea is better than the others.',
  ],
  temple: [
    'Let my son pass the exam.',
    'I am not asking for much.',
    'The incense smells like my childhood.',
    'Let the rain come in time.',
    'My grandmother knelt on this stone.',
    'Thank you. Just thank you.',
    'I will try to be kinder.',
    'Let him come home from the river.',
  ],
  park: [
    'The willows are heavy this year.',
    'Cooler here than in the lane.',
    'The old man feeds the birds again.',
    'Five more breaths, then I go.',
    'My knees are not what they were.',
    'It is quiet inside the wall.',
    'Nothing is wrong. That is strange.',
  ],
  street: [
    'The drum sounded. I am late.',
    'The gate closes at dusk.',
    'This cart is heavier than it was.',
    'It will rain before I reach the bridge.',
    'I should have taken the other lane.',
    'The ox is slow today. So am I.',
    'My sandals are worn through.',
    'Just get to the market and back.',
    'One day I will walk this road for pleasure.',
  ],
};
