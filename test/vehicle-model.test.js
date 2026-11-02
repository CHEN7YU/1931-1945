import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { historicalVehicleModel, vehicleWeaponView, VEHICLE_PROFILES, JAPANESE_AIRCRAFT_PROFILE } from '../src/vehicle-model.js';
import { tankModel, planeModel, weaponModel } from '../src/world.js';

function geometryStats(model) {
  let triangles = 0, calls = 0;
  model.traverse(object => {
    if (!object.isMesh) return;
    calls++;
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    for (const attribute of Object.values(object.geometry.attributes))
      assert.ok(attribute.array.every(Number.isFinite), 'all uploaded attributes must be finite');
    assert.ok(object.geometry.attributes.normal, 'curved surfaces have lighting normals');
  });
  return { triangles, calls };
}
function contacts(model, from, direction) {
  model.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...direction), 0, 20)
    .intersectObject(model, true);
}

test('Vickers Type B replaces the oversized placeholder with a proportioned three-man light tank', () => {
  const model = tankModel(), profile = VEHICLE_PROFILES.tank;
  assert.equal(model.userData.profile.model, 'vickers-e-b');
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - profile.width) < .02);
  assert.ok(Math.abs(size.z - profile.length) < .08);
  assert.ok(Math.abs(bounds.max.y - profile.height) < .03);
  assert.ok(bounds.min.y >= 0 && bounds.min.y < .05, 'tracks sit at ground level without burying wheels');
  assert.ok(model.userData.turret.position.x < 0, 'single turret is offset from the driver, not a centered modern turret');
  assert.equal(model.userData.gun.parent, model.userData.turret);
  const stats = geometryStats(model);
  assert.ok(stats.calls <= 16 && stats.triangles < 20000, JSON.stringify(stats));
});

test('I-15bis has two real airfoil wings, smaller lower span, radial nose and fixed landing gear', () => {
  const model = planeModel(), profile = VEHICLE_PROFILES.plane;
  assert.equal(model.userData.profile.model, 'i-15bis');
  assert.equal(model.userData.details.engineCoolingFins, 9);
  assert.equal(model.userData.details.fuselageSections, 48);
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - profile.span) < .01);
  assert.ok(Math.abs(size.z - profile.length) < .1);
  const inner = contacts(model, [2, 3, -.8], [0, -1, 0]);
  assert.ok(inner.some(hit => hit.point.y > 1 && hit.face.normal.y > .5), 'upper wing faces outwards, not inside out');
  assert.ok(inner.some(hit => hit.point.y < -.35 && hit.point.y > -.5), 'lower wing is not just a painted line');
  const outer = contacts(model, [4.1, 3, -.8], [0, -1, 0]);
  assert.ok(outer.some(hit => hit.point.y > 1));
  assert.ok(outer.every(hit => hit.point.y > .9), 'lower wing ends inboard of upper wing');
  assert.ok(contacts(model, [2, -3, -.8], [0, 1, 0]).some(hit => hit.point.y < -.4 && hit.face.normal.y < -.5));
  assert.ok(contacts(model, [0, 3, 1.6], [0, -1, 0]).some(hit => hit.point.y > .3), 'tapered rear fuselage faces outwards');
  assert.ok(contacts(model, [2, -1.31, -1.05], [-1, 0, 0]).length, 'undercarriage remains extended');
  const stats = geometryStats(model);
  assert.ok(stats.calls <= 14 && stats.triangles < 23000, JSON.stringify(stats));
});

test('wing markings conform across their interiors, not just at the rim of a flat decal', () => {
  const model = planeModel();
  for (const side of [-1, 1]) for (let i = 0; i < 24; i++) for (const radius of [.12, .24, .36, .44]) {
    const angle = i * Math.PI / 12;
    const hit = contacts(model, [side * 3.85 + Math.cos(angle) * radius, 3, -.85 + Math.sin(angle) * radius], [0, -1, 0])[0];
    assert.ok(hit, 'painted upper wing has physical geometry');
    assert.equal(Boolean(hit.object.material.vertexColors), false, 'base wing cannot poke through its roundel');
  }
});

test('enemy aircraft reuse the Japanese Ki-10 template with red markings rather than the Chinese I-15bis', () => {
  const friendly = planeModel(), enemy = planeModel('enemy'), second = planeModel('enemy');
  const colors = model => {
    const result = new Set();
    model.traverse(object => { if (object.isMesh) result.add(object.material.color.getHex()); });
    return result;
  };
  assert.ok(colors(friendly).has(0x183e80));
  assert.equal(colors(friendly).has(0xa52c24), false);
  assert.ok(colors(enemy).has(0xa52c24));
  assert.equal(colors(enemy).has(0x183e80), false, 'enemy aircraft must not retain Chinese wing or tail insignia');
  assert.equal(enemy.userData.profile, JAPANESE_AIRCRAFT_PROFILE);
  assert.equal(friendly.userData.profile, VEHICLE_PROFILES.plane);
  assert.equal(enemy.children[0].geometry, second.children[0].geometry);
  assert.notEqual(enemy.userData.propeller, second.userData.propeller);
  const size = new THREE.Box3().setFromObject(enemy).getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - JAPANESE_AIRCRAFT_PROFILE.span) < .01);
  assert.ok(geometryStats(enemy).calls <= 14);
});

test('repeated vehicles share immutable geometry and materials, not turret, gun or propeller transforms', () => {
  for (const type of ['tank', 'plane']) {
    const first = historicalVehicleModel(type), second = historicalVehicleModel(type);
    assert.equal(first.children[0].geometry, second.children[0].geometry);
    assert.equal(first.children[0].material, second.children[0].material);
    const part = type === 'tank' ? 'turret' : 'propeller';
    assert.notEqual(first.userData[part], second.userData[part]);
    first.userData[part].rotation.y = .8;
    assert.ok(Math.abs(second.userData[part].rotation.y) < 1e-12);
    if (type === 'tank') {
      first.userData.gun.rotation.x = .4;
      assert.ok(Math.abs(second.userData.gun.rotation.x) < 1e-12);
    }
  }
});

test('first-person views use matching vehicle profiles and shared buffers without opaque center-screen slabs', () => {
  for (const type of ['tank', 'plane']) {
    const first = weaponModel(type), second = vehicleWeaponView(type);
    assert.equal(first.userData.profile.model, VEHICLE_PROFILES[type].model);
    if (type === 'plane') {
      assert.equal(first.children[0].geometry, second.children[0].geometry);
      assert.equal(first.userData.details.roundedWindscreen, true);
      assert.equal(first.userData.details.lowerWingVisible, true);
    }
    else assert.equal(first.children.length, 0, 'closed optics do not add a floating hatch or large window model');
    assert.ok(geometryStats(first).calls <= 7);
    const opaqueCenter = contacts(first, [0, 0, 0], [0, 0, -1]).filter(hit => !hit.object.material.transparent);
    assert.equal(opaqueCenter.length, 0, 'pilot and gunner retain an unobstructed center sightline');
  }
  assert.throws(() => historicalVehicleModel('unknown'), /Unknown historical vehicle/);
  assert.throws(() => vehicleWeaponView('unknown'), /Unknown vehicle view/);
});

test('all tank seats use closed apertures without floating hatch rims or large open windows', () => {
  const views = ['commander', 'gunner', 'driver'].map(seat => vehicleWeaponView('tank', seat));
  for (const [index, seat] of ['commander', 'gunner', 'driver'].entries()) {
    const view = views[index], other = vehicleWeaponView('tank', seat), stats = geometryStats(view);
    assert.equal(view.userData.observationSeat, seat);
    assert.equal(view.userData.optical, true);
    assert.equal(view.children.length, 0);
    assert.equal(other.children.length, 0);
    assert.equal(stats.calls, 0, 'no open-hatch rim, gauges or cannon breech in an optical view');
    assert.ok(stats.calls <= 7 && stats.triangles < 12000, `${seat}: ${JSON.stringify(stats)}`);
    assert.equal(contacts(view, [0, 0, 0], [0, 0, -1]).filter(hit => !hit.object.material.transparent).length, 0);
  }
  assert.equal(views[1].userData.breech, null);
  assert.equal(views[2].userData.breech, null);
});
