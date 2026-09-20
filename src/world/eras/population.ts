/**
 * How many people live here. The same number in every era, deliberately.
 *
 * It was 12,000 in 2020, 8,000 in 1800 and a requested 13,000 in 2300, and
 * changing era visibly emptied or filled the streets, which reads as the
 * simulation faltering rather than as a different century. The town is the
 * same town: it should be as busy in one age as in another.
 *
 * 2300 never actually reached its 13,000. `populate` will not put more people
 * in a town than `homes * POOL.perHomeLot`, and 2300 is built high on few
 * plots, so its 590 home lots capped it at 8,260 however much it asked for.
 * That ceiling is why `perHomeLot` had to go up along with this: the number
 * here is a wish, and the ceiling is what grants it.
 *
 * It lives in a file of its own, with no imports, because the eras cannot
 * take it from `eras/index.ts`: that module imports every era to build the
 * registry, so an era importing back from it is a cycle. It typechecks and
 * then hands out `undefined` at startup, which is how this was found.
 */
export const ERA_POPULATION = 12000;
