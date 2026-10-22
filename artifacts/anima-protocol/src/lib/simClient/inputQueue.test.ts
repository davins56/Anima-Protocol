import { describe, expect, it } from "vitest";
import { MAX_ACTIONS_PER_SECOND, MAX_ACTIONS_PER_TICK } from "@workspace/sim-core";
import { InputQueue } from "./inputQueue";
import { FixedStepLoop } from "./fixedStepLoop";

describe("InputQueue", () => {
  it("stamps inputs with the tick they are applied at", () => {
    const q = new InputQueue();
    q.push({ t: "buster" });
    q.push({ t: "move", dc: 1, dr: 0 });
    expect(q.take(7)).toEqual([
      { tick: 7, action: { t: "buster" } },
      { tick: 7, action: { t: "move", dc: 1, dr: 0 } },
    ]);
    expect(q.take(8)).toEqual([]);
    expect(q.log.map((a) => a.tick)).toEqual([7, 7]);
  });

  it("caps inputs per tick and spills the rest to later ticks in order", () => {
    const q = new InputQueue();
    for (let i = 0; i < 5; i++) q.push({ t: "move", dc: 0, dr: i % 2 ? 1 : -1 });
    expect(q.take(1)).toHaveLength(MAX_ACTIONS_PER_TICK);
    expect(q.take(2)).toHaveLength(5 - MAX_ACTIONS_PER_TICK);
    const ticks = q.log.map((a) => a.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it("enforces the per-second cap the server validates", () => {
    const q = new InputQueue();
    let applied = 0;
    for (let tick = 1; tick <= 20; tick++) {
      q.push({ t: "buster" });
      q.push({ t: "buster" });
      applied += q.take(tick).length;
    }
    expect(applied).toBe(MAX_ACTIONS_PER_SECOND);
  });

  it("coalesces streamed phase targets to the latest", () => {
    const q = new InputQueue();
    q.push({ t: "phase", toW: 40 });
    q.push({ t: "phase", toW: 42 });
    q.push({ t: "phase", toW: 44.5 });
    expect(q.take(3)).toEqual([{ tick: 3, action: { t: "phase", toW: 44.5 } }]);
  });

  it("loop applies queued input on the next tick boundary, not mid-frame", () => {
    const loop = new FixedStepLoop({ seed: 1, companionId: "serenity", startW: 60, enemies: [{ kind: "mettaur", band: "data" }], memoryPool: [] });
    loop.update(70); // tick 1, 20 ms into tick 2
    loop.enqueue({ t: "move", dc: 0, dr: 1 });
    expect(loop.curr.units[0].row).toBe(1);
    loop.update(30); // reaches tick 2
    expect(loop.input.log).toEqual([{ tick: 2, action: { t: "move", dc: 0, dr: 1 } }]);
    expect(loop.curr.units[0].row).toBe(2);
  });
});
