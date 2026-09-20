import type { ThoughtSet } from '@/thoughts/content';

/**
 * What people worry about in Wyrmrest. Same rules as every other set (PLAN.md
 * 7): first person, present tense, under sixty characters, gentle.
 *
 * The magic is in the nouns and nowhere else. There is a wyrm asleep under the
 * hill and there are things in the wood, and none of that has changed what
 * anybody is actually thinking about: the rent, the child, the knee that hurts
 * in the cold, whether he meant what he said. Several of these are word for
 * word the ones from 1800 and 2020, which is the whole point of the piece.
 *
 * Nobody here is awed by their own world. You are not amazed by the weather
 * you grew up in, and a monster you have lived beside all your life is a
 * nuisance, a danger and a piece of local news, in that order. So: nobody
 * narrates the magic, nobody explains the rules of it, and nobody says
 * anything a person would not say about a wolf.
 */
export const MYTH_THOUGHTS: ThoughtSet = {
  home: [
    'The fire is going out and I am not moving.',
    'I should call on my mother.',
    'The roof leaks over the bed, of course.',
    'Rent is due at the quarter day.',
    'One more winter, then I rest.',
    'She still has not sent word.',
    'The beans came up better on the north side.',
    'The little one is frightened of the hill again.',
    'He has grown out of his boots. Again.',
    'Salt the rest of it before it turns.',
  ],
  work: [
    'It has to be finished before the gate shuts.',
    'Nobody checked it. I know nobody checked it.',
    'Three of us do the work of one.',
    'I do not understand half of what I am told.',
    'If I keep my head down, nobody notices me.',
    'He got the contract. I taught him the trade.',
    'It will hold. It has held for eighty years.',
    'I have counted it twice. I will count it again.',
    'My hands are worse in this cold.',
  ],
  market: [
    'Everything is dearer since the road closed.',
    'She keeps the good ones under the counter.',
    'I came for one thing and forgot the thing.',
    'The eggs are better than they were.',
    'Nobody has time to cook it anyway.',
    'He gives honest weight. I go back to him.',
    'Trade for it. Do not pay coin for it.',
    'That is the third cart through today.',
  ],
  temple: [
    'Let her come home before the cold.',
    'My grandmother knelt where I am kneeling.',
    'It is quiet here, and I am grateful.',
    'I do not know if anyone is listening.',
    'Let it go well. Just this once.',
    'I say their names. It costs me nothing.',
    'Thank you. Just thank you.',
    'Keep him off the hill. That is all I ask.',
  ],
  park: [
    'The birds came back before we did.',
    'Sit a while. Nothing is waiting.',
    'The light is better on this side.',
    'My father climbed that one as a boy.',
    'The bees are early this year.',
    'I have not been down here in months.',
    'You can hear it breathing if you stay still.',
  ],
  street: [
    'The gate shuts at dusk and I am slow.',
    'I know this turning without looking.',
    'Everyone is looking up except me.',
    'Rain by evening, I should think.',
    'That was not here last spring.',
    'They came back three short. Nobody is saying.',
    'Do not look at it. Just keep walking.',
    'The bell went early. That is never good.',
    'It is only twenty minutes on foot.',
  ],
};
