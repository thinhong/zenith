/**
 * Where a thought pill goes, given the head it belongs to and the pills
 * already on screen.
 *
 * Pure pixel arithmetic, kept out of thoughts.ts so it can be tested: this is
 * the part that decides whether a thought reads as belonging to a person or as
 * a caption stuck to the architecture, and it broke silently once already.
 *
 * Three things happen here, in order:
 *
 * 1. The pill slides in off the edge of the frame, because one centred on
 *    somebody standing at the edge hangs half outside it and the text is cut
 *    in two. The tail then leans over to keep pointing at the head, the way a
 *    speech bubble's does.
 * 2. It lifts clear of any pill already occupying that patch of screen.
 * 3. If the lift has taken it too far from its own head, it is refused
 *    outright. A stranded pill above a crowd belongs to nobody.
 */

export interface PlaceLimits {
  /** Frame size in pixels. */
  width: number;
  height: number;
  /** How close to the left or right edge a pill's centre may sit. */
  edgePx: number;
  /** Pills nearer than this vertically, within `spreadPx`, are nudged apart. */
  gapPx: number;
  spreadPx: number;
  /** How many times to try lifting a pill clear before giving up. */
  nudgeLimit: number;
  /** How far a pill may be lifted off its own head before it is refused. */
  maxStemPx: number;
}

export interface PillPlacement {
  /** Where the pill's bottom centre goes. */
  pillX: number;
  pillY: number;
  /** How far the tail leans from the pill's centre, to stay on the head. */
  tailPx: number;
  /** Length of the thread back down to the head. Zero when it sits on it. */
  stemPx: number;
}

/**
 * Returns where to put the pill, or undefined when it should not be shown.
 * `taken` is the pills already placed this frame; it is not modified.
 */
export function placePill(
  headX: number,
  headY: number,
  taken: readonly { x: number; y: number }[],
  limits: PlaceLimits,
): PillPlacement | undefined {
  // An edge allowance wider than half the frame would push pills from both
  // sides into the middle, so it is clamped to something the frame can hold.
  const edge = Math.min(limits.edgePx, limits.width / 2);
  const pillX = Math.min(Math.max(headX, edge), limits.width - edge);

  let pillY = headY;
  for (let attempt = 0; attempt < limits.nudgeLimit; attempt++) {
    let clash: { x: number; y: number } | undefined;
    for (const other of taken) {
      if (
        Math.abs(other.y - pillY) < limits.gapPx &&
        Math.abs(other.x - pillX) < limits.spreadPx
      ) {
        clash = other;
        break;
      }
    }
    if (!clash) break;
    pillY = clash.y - limits.gapPx;
  }

  const stemPx = headY - pillY;
  if (stemPx > limits.maxStemPx) return undefined;
  return { pillX, pillY, tailPx: headX - pillX, stemPx: Math.max(0, stemPx) };
}
