// 坡地步态（各地图通用）：步兵在有高差的地形上行走时的移动速度与步频。
// 背景：nra-motion.js 只按水平位移推进步态周期，平地上没有问题；但在山坡上，人物沿坡面实际走过的路程比水平位移长，
// 若仍按水平位移计步，看起来就像“平移”着滑上坡。本模块：
//   1. terrainStep()：按坡度换算一步的水平位移（上坡变慢、下坡略快、过陡不可攀），并给出沿坡面的实际路程；
//   2. applyTerrainGait()：把沿坡面的路程折算成步幅缩放，交给 nra-motion 的 strideScale，使上坡时步子更碎、步频更高。
// 只依赖传入的高度函数，不依赖任何地图；以后有山地的地图可以直接复用（江阴为第一个使用者）。
export const TERRAIN_GAIT = Object.freeze({
  maxClimb: 1.7,        // 可攀爬的最大坡度（高差/水平距离），约 60°
  uphillDrag: 1.3,      // 上坡减速系数：水平速度 ÷ (1 + 坡度 × uphillDrag)
  downhillBoost: .12,   // 缓下坡略快（最多 +12%）
  steepDownhill: .45,   // 超过此坡度的下坡需要放慢脚步
  uphillStride: .45,    // 上坡步幅缩短系数：步幅 × 1 / (1 + 坡度 × uphillStride)
  minStride: .55,
});

// heightAt(x, z) → 地面高度；(dirX, dirZ) 为水平单位方向；speed 为平地速度（米/秒）
export function terrainStep(heightAt, x, z, dirX, dirZ, speed, dt) {
  // 坡度取前后各 0.8 米的中心差分：只反映“坡”，不被地表的小坑小包左右，避免奔跑时速度一快一慢地抖动
  const probe = Math.max(.8, speed * dt);
  const grade = (heightAt(x + dirX * probe, z + dirZ * probe) - heightAt(x - dirX * probe * .5, z - dirZ * probe * .5)) / (probe * 1.5);
  if (grade > TERRAIN_GAIT.maxClimb) return { ok: false, grade, horizontal: 0, path: 0, factor: 0 };
  let factor;
  if (grade >= 0) factor = 1 / (1 + grade * TERRAIN_GAIT.uphillDrag);
  else if (-grade < TERRAIN_GAIT.steepDownhill) factor = 1 + TERRAIN_GAIT.downhillBoost * (-grade / TERRAIN_GAIT.steepDownhill);
  else factor = 1 / (1 + (-grade - TERRAIN_GAIT.steepDownhill) * 1.1);
  const horizontal = speed * dt * factor;
  return { ok: true, grade, factor, horizontal, path: horizontal * Math.hypot(1, grade),
    x: x + dirX * horizontal, z: z + dirZ * horizontal };
}

// 步幅缩放：沿坡面路程 / 水平位移 越大（越陡），步幅越短 → 同样的水平位移走更多步
export function terrainStrideScale(grade) {
  const slope = Math.hypot(1, grade);
  const uphill = grade > 0 ? 1 / (1 + grade * TERRAIN_GAIT.uphillStride) : 1;
  return Math.max(TERRAIN_GAIT.minStride, uphill / slope);
}

// actor：nra-motion 的人物状态（含 nativeMotion）。grade 为当前前进方向的坡度。
// 第一次调用时记住该人物原有的 strideScale（个体差异），之后在其基础上按坡度缩放；平地上恢复原值。
export function applyTerrainGait(actor, grade = 0) {
  const motion = actor?.nativeMotion;
  if (!motion || !Number.isFinite(grade)) return;
  motion.baseStrideScale ??= motion.strideScale;
  const target = motion.baseStrideScale * terrainStrideScale(grade);
  motion.strideScale += (target - motion.strideScale) * .25;   // 平滑过渡，避免坡度突变时步态跳帧
}
