const reasons = {
  vault: '正在翻越 · 落地后再操作武器',
  driver: '驾驶员不能操作主炮 · 按 Y 切换车长或炮手',
  sprint: '冲刺中无法举枪射击 · 松开 Shift 并等待举枪',
  recovery: '正在恢复举枪 · 稍后可射击',
  obstruction: '枪口受阻 · 后退或移开枪口',
  reload: '正在装填 · 完成后可射击',
  cycle: '正在拉栓／循环 · 完成后可射击',
  readying: '正在准备武器 · 稍后可射击',
  empty: '弹药已空 · 按 R 装填',
  full: '弹药已满 · 无需装填',
  'shell-limit': '在飞炮弹已达上限 · 等待弹着后再射击',
};

export function weaponRestriction(facts, action = 'fire') {
  if (!['fire', 'aim', 'reload'].includes(action)) throw new RangeError(`Unknown weapon feedback action: ${action}`);
  const reason = code => ({ code, text: reasons[code] });
  if (!facts.firearm) return null;
  if (facts.vaulting) return reason('vault');
  if (!facts.canFire) return reason('driver');
  if (action === 'reload') {
    if (facts.reloading) return reason('reload');
    if (facts.ammo >= facts.magazine) return reason('full');
    return null;
  }
  if (facts.sprinting) return reason('sprint');
  if (facts.recovery > 0) return reason('recovery');
  if (action === 'fire' && facts.shellLimit) return reason('shell-limit');
  if (facts.obstruction > 0 || facts.obstructionBlend > .03) return reason('obstruction');
  if (facts.reloading) return reason('reload');
  if (facts.cycling && (action === 'fire' || facts.scoped)) return reason('cycle');
  if (action === 'fire' && facts.readying) return reason('readying');
  if (action === 'fire' && facts.ammo <= 0) return reason('empty');
  return null;
}
