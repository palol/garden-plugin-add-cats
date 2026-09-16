# Add Cats

Pixel cats that live on selected pages of a Digital Garden. Tag a page, and
resident cats appear, settle, and stay. Click or tap anywhere and the cats run
to that spot. Zero dependencies, no tracking, no third-party requests.

![Add Cats on a page](screenshot.png)

## Install

From the Digital Garden community browser after the plugin is listed, or paste
this repository URL into the plugin installer. For manual installation, copy the
repository into `src/plugins/add-cats/`, enable `add-cats` in
`src/plugins/plugins.json`, and rebuild.

The plugin ships the classic public-domain Neko sprites, so it works with no
configuration.

## Tag the pages that get cats

Cats appear on a page only when that page is tagged. Add the note flag to the
note's frontmatter:

```yaml
---
dg-add-cats: true
---
```

The plugin reads the flag through Digital Garden's note-settings mechanism, so
you decide per page: your guestbook can have cats, your resume stays serious.
Set `ADD_CATS_ENABLED=false` to turn the plugin off everywhere without touching
any note.

## Click behavior

- **clicked** (default) — the nearest cat walks to where you click.
- **stampede** — every cat runs to the click point, each at its own speed.

## Skins

Two classic skins ship with the plugin: `neko` (black cat) and `tabby`. By
default each resident cat picks a random bundled skin, so a page shows a mix.
Set `skin` to pin one skin for every cat.

To pin a specific set of distinct cats, give `skin` a JSON array of skin ids —
one resident cat per id, cycling if there are more cats than ids:

```json
{ "skin": "[\"greta\",\"nigel\"]", "skins": "{\"greta\":\"/img/user/greta-neko.png\",\"nigel\":\"/img/user/nigel-neko.png\"}" }
```

This is how the plugin powers a "Meet the cats" page: Greta and Nigel render
side by side, each with their own sprite sheet.

### Bring your own sprite sheet

Any skin can be supplied by the site owner. Point a skin id at a sprite sheet
with the `skins` setting:

```json
{ "calico": "/nekos/calico.png", "grey-mittens": "https://example.com/cat.png" }
```

Then select it with `skin`, or list it and let the random picker use it. Sheets
must be the classic Neko layout (263x197, 8x6 grid of 32px cells, 1px separators)
or the oneko layout (256x128, 8x4 grid of 32px cells); the plugin detects which
one it received.

Additional public-domain classic skins are archived at
<https://bomvel.neocities.org/neko/>. Download a sheet, place it in your garden,
and register it with the `skins` setting. If the sheet has a flat background
color instead of transparency, set `chromaKey` to that color and the plugin keys
it out.

## Settings

Digital Garden hosts do not yet render a full settings panel, so environment
variables are the no-code configuration path. A site owner can also set values
in `src/plugins/plugins.json`; those take precedence over environment values,
which take precedence over the defaults below.

| Setting | Default | Rules |
| --- | --- | --- |
| `enabled` | true | Master toggle; cats still require the note flag |
| `count` | 3 | Residents per tagged page, clamped 1 to 5 |
| `scale` | 32 | Rendered sprite size in pixels, clamped 16 to 64 |
| `summonMode` | clicked | `clicked` or `stampede` |
| `skin` | random | Skin id, `random` for a mix, or a JSON array of ids to pin distinct named cats |
| `speeds` | (empty) | JSON map of skin id to walk speed in px/step, e.g. `{"nigel":13}`; absent skins use a random 5–14 |
| `chromaKey` | (empty) | Hex color removed from a sheet that has a flat background |
| `skins` | (empty) | JSON map of skin id to sprite-sheet URL or path |

Environment names use the `ADD_CATS_` prefix, such as `ADD_CATS_COUNT` and
`ADD_CATS_SUMMON_MODE`.

## Accessibility and behavior

Cats are decorative: each is `aria-hidden`, ignores pointer events, and never
covers or blocks page content. When the visitor prefers reduced motion, the cats
hold a static idle pose instead of animating.

The plugin makes no network requests other than loading the sprite sheets you
configure. It uses no cookies, no storage, and sends nothing anywhere.

## Compatibility, upgrades, and rollback

Built for Digital Garden 1.90-compatible plugin APIs and Node 22. Releases follow
SemVer and tags match `garden-plugin.json`.

To remove the plugin, delete its entry from `src/plugins/plugins.json` and
remove `src/plugins/add-cats/`. No notes or external data need migration.

## Development

```sh
npm install
npm test
```

## Credits

Bundled sprites are the classic Neko sprites, considered public domain (see the
Neko Archive linked above). The wandering and click-to-direct behavior follows
oneko.js by adryd (MIT), the reference web implementation of the original Neko
program.
