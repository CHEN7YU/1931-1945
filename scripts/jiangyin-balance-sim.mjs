import * as THREE from 'three';
import { createJiangyinGame } from '../src/jiangyin/jiangyin-game.js';
import { aimEmplacement } from '../src/emplacements.js';
function rng(seed){ return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
const stub = point => { const g = new THREE.Group(); g.userData.update = () => { g.position.x = point.x; g.position.z = point.z; g.rotation.y = point.heading; }; return g; };
const mode = process.argv[2] ?? 'ai';
const results = {};
const seeds = Number(process.argv[3] ?? 12);
for (let seed = 1; seed <= seeds; seed++) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 1.6, .1, 900);
  const events = [];
  const game = createJiangyinGame({ scene, camera, createGunModel: stub, random: rng(seed * 7919), onEvent: e => events.push(e) });
  let t = 0, sw = 0;
  game.skipIntro();
  while (game.state.phase !== 'ended' && t < 1100) {
    if (game.state.phase === 'scuttle') game.skipScuttle();   // 自沉演出不影响平衡，直接跳过
    const input = {};
    if (mode === 'bot' && (game.state.phase === 'naval' || game.state.phase === 'hold')) {
      // crude player stand-in: aim own gun at the nearest live ship with lead and fire
      const post = game.posts.find(p => p.id === game.controlledId);
      const ship = post && game.ships.filter(s => s.sinking === null)
        .sort((a, b) => Math.hypot(a.x - post.point.x, a.z - post.point.z) - Math.hypot(b.x - post.point.x, b.z - post.point.z))[0];
      if (post && ship) { const d = Math.hypot(ship.x-post.point.x, ship.z-post.point.z), f = d/(post.point.weapon.settings.shellSpeed ?? 260);
        aimEmplacement(post.point, { x: ship.x - ship.speed*f, y: 1.6 + 4.9*f*f, z: ship.z }, 1/60, post.floor); input.fireHeld = true; }
      if (game.state.phase === 'hold' && Math.floor(t) % 40 === 0 && Math.floor(t) !== sw) { sw = Math.floor(t); input.switchPost = 1; }
    }
    game.step(1/60, input); t += 1/60;
  }
  const o = game.state.outcome; const key = o ? `${o.result}:${o.reason}` : 'none';
  results[key] = (results[key] ?? 0) + 1;
  if (seed <= 4) console.log(seed, key, 'naval', game.state.navalTime.toFixed(0), 'hold', game.state.elapsed.toFixed(0), JSON.stringify(game.state.stats),
    'posts', game.posts.map(p => Math.round(p.point.health)).join('/'), 'scene', scene.children.length);
}
console.log(mode, results);
