# vigil

Synced lyric videos for machine-sung music — a candle flame that listens.
Named for what a light left burning is.

Born from a real problem: sung diction from a formant synth or DiffSinger
voicebank is never perfect, and human listeners can't parse sung lyrics
without a sheet anyway (vocaloid culture solved this years ago: the lyric
video *is* the sheet). Here the sheet is free and exact — the
[etudes](../etudes) composition system owns every syllable's timing on the
beat grid before any audio exists, and exports it as a manifest
(`etudes/manifest.py`). No forced alignment, no ASR, no hand-syncing.

## Architecture

```
etudes  ──(manifest.json + audio)──►  vigil
         word events, line grouping,        page/vigil.js   renderFrame(t):
         voices, sections, envelopes        pure, deterministic canvas frame
                                            ├── preview: <audio> clock + rAF
                                            └── export:  tools/render.mjs
                                                 headless chromium, CDP
                                                 frame-step → ffmpeg → mp4
```

Everything on screen is a pure function of `t` and the manifest: no
`Math.random`, no wall clock. The offline render steps time explicitly
over CDP, so there are no rAF-suspension or virtual-time-budget traps and
every run produces the identical video. Fully Linux-native — no Windows
interop, no WSLg, no GPU.

## Use

```bash
# live preview (WSL2 shares localhost — open in any Windows browser):
python3 tools/serve.py            # → http://localhost:8391/page/?song=lights_were_on
# click/space to play, arrows to seek

# offline render:
node tools/render.mjs lights_were_on 30    # → out/lights_were_on.mp4
```

## The visual language

The flame is the VU meter: it leans and flickers with the vocal envelope
(`env.vox_smooth` from the manifest), burns brighter per section (chorus >
verse; the map is `SECTION_B` in vigil.js), and gutters — pale, small,
strange — while the 1980 klattsch formant voice sings, whose lines also
render in typewriter type with a jittered baseline. In the outro it calms
to an ember and **does not go out**.

## Adding a song

1. Label the song's phrases with `word=` in etudes and call
   `export_manifest(...)` (see `songs/lights_were_on.py` there).
2. Symlink `songs/<name>/manifest.json` and `songs/<name>/audio.mp3` here.
3. Adjust `SECTION_B` if the new song's section names differ.

Fonts: EB Garamond & Courier Prime, vendored under OFL in `assets/fonts/`.
