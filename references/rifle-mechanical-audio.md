# Independent rifle mechanical audio candidate

This batch does not change `main.js`, rifle actions, simulation, characters,
damage, dependencies or game controls. It does not yet change the game's sound.
The existing synthetic mechanical feedback remains in place until integration.

## Sources and limits

The four excerpts total less than 60,000 bytes, mono 24kHz 16-bit PCM.
Exact byte counts, SHA256 hashes, original download URLs and extraction windows
are in `public\assets\audio\rifle-mechanical\source.json`.

- LFA's [equipment clicks III](https://opengameart.org/content/equipment-clicks-iii)
  explicitly lists CC0. The author describes a mixed recording of a bolt-action
  rifle, stapler and tape measure. Three excerpts are assigned to `unlock`,
  `extract` and `close` as Foley; their individual objects are **not verified**.
- BMacZero's [Gun Reload Sound Effects](https://opengameart.org/content/gun-reload-sound-effects)
  explicitly lists CC0 and optional credit to Brian MacIntosh. `clipload1.wav`
  supplies `load`. It is not authenticated period stripper-clip audio.

CC0 permits public repository and browser redistribution and modification.
Source credits are retained in `LICENSE.txt`. No original whole library is
published and no asset is taken from another game. These are not verified
Chinese or Japanese rifle recordings. Automatic checks do not prove good
listening quality or battlefield mixing.

`extract` is the current action's bolt extraction cue. It also occurs during
reload and **does not establish that a case exists or has hit the ground**.
There is deliberately no case-impact sound or independent audio timer.

## Integration contract

`loadRifleMechanicalAudio()` loads and decodes once at startup. Its rejection
must be logged and shown using the existing audio warning/fallback pattern,
not silently swallowed. Keep the synthetic mechanical implementation for a
reported load failure. Do not mix the synthetic and recorded versions of the
same accepted cue.

The mixer is personal audio only: it consumes the existing flat
`weapon.mechanical` event with `id`, `time`, `soldierId`, `weaponId` and `cue`.
It does not add NPC mechanical audio, spatial sound or new action rules.

Before draining each actual render's feedback batch:

```js
mechanicalAudio?.beginBatch(
  personalOwner
    ? { soldierId: personalOwner.soldierId, weaponId: personalOwner.weaponId }
    : null,
  personalRifleActive,
);
```

`personalRifleActive` must be a boolean derived from the existing playing,
living, personal-infantry, unseated and rifle-equipped state. It must be false
when there is no owner. Pass the original event, not a reconstruction using
the current soldier or a new event serial:

```js
if (event.type === 'weapon.mechanical') {
  mechanicalAudio?.play(audioContext, event);
}
```

Call `sync(ownerOrNull, personalRifleActive)` immediately on pause, death,
ownership/weapon change, stowing or entering a vehicle, even when there are no
pending sound events. This stops tails; resuming never reschedules them.
Ownership is copied and checked using both soldier and weapon identity.
Do not use the boolean result to trigger synthetic fallback: false also
means a deliberately discarded duplicate, inactive, suspended or excess cue.

Call `reset()` alongside `createControlEvents().clear()` at new-match reset,
then synchronize the new owner normally. Event IDs are monotonically consumed
within that match, including rejected events. Y switching is **not** a reset.
At most three starts occur per batch, four voices coexist, and the diagnostic
history holds 32 entries. Excess cues are discarded rather than queued for
later replay. The module does not alter ammo, action timing or simulation.

The asset audit explicitly classifies this directory as `diagnostic` while
integration is pending. Vite still copies the small candidate files into
`dist`; they are not requested by the current main game. When integrated,
change that one classification to `runtime` and update the shared README/TODO
in the integration branch, not by overwriting another branch's documents.

## Reproduction and checks

Download the two original WAVs using their `source.json` URLs into a scratch
directory, not the public assets directory. With FFmpeg on PATH:

```powershell
node scripts\prepare-rifle-mechanical-audio.mjs C:\path\to\downloads
node --test test\rifle-mechanical-audio.test.js test\rifle-action.test.js test\weapon-simulation.test.js test\asset-audit.test.js
node scripts\rifle-mechanical-audio-smoke.mjs
```

The preparation script rejects altered originals before processing and writes
only the four excerpts and their generated metadata. Different FFmpeg versions
may produce different bytes; review changed hashes rather than silently
accepting another original.

The browser smoke uses intercepted local URLs, no running dev server and no
external runtime requests. It exercises actual browser WAV decoding, an offline
audio graph, and ownership/pause stop behavior. It is not a battlefield test or
a listening acceptance test. Main-game integration and an actual listening
comparison remain explicitly pending.
