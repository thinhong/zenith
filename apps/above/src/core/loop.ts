export interface LoopCallbacks {
  /** dt in seconds (clamped), elapsed in seconds since start */
  update: (dt: number, elapsed: number) => void;
  render: () => void;
}

/** requestAnimationFrame loop with a clamped delta so tab switches do not explode simulation. */
export function startLoop({ update, render }: LoopCallbacks): () => void {
  let last = performance.now();
  let elapsed = 0;
  let running = true;

  const frame = (now: number): void => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    elapsed += dt;
    update(dt, elapsed);
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return () => {
    running = false;
  };
}
