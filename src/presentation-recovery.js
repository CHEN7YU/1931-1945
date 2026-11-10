export function createBattleFrameLoop({ requestFrame, step, active, record }) {
  function frame(now) {
    if (!active()) return;
    requestFrame(frame);
    try { step(now); }
    catch (error) { record(error instanceof Error ? error : new Error(String(error))); }
  }
  return frame;
}

export function createPresentationRecovery(record) {
  const failed = new WeakMap();
  return {
    run(view, present, context) {
      if (failed.has(view)) { view.visible = false; return false; }
      try {
        present();
        return true;
      } catch (error) {
        failed.set(view, view.visible);
        view.visible = false;
        record(error instanceof Error ? error : new Error(String(error)), {
          ...context, stage: 'battle', details: { component: 'first-person-dadao', recovery: 'hide-until-reequipped' },
        });
        return false;
      }
    },
    reset(view) {
      if (!failed.has(view)) return;
      view.visible = failed.get(view);
      failed.delete(view);
    },
  };
}
