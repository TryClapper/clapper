# Clapper Open Source

Make a launch video for your product from its website. Claude reads the site, writes a hook, problem, fix
story, builds animated scenes in your site's own colours, fonts and logo, and renders an mp4 with music and
sound effects. The video is made on your computer, on your own Claude.

**Open core.** The code here (the plugin, the local page, the video kit and the engine) is open source under
the AGPL. The instructions Claude follows to make a video (the skill, the story writing, "Ask for a fix" and
the Pile, Tangle and Dilemma style guides) are run by Clapper: the plugin and the page fetch them from tryclapper.co
each time they need them, so they're always the current ones. That's why **Clapper needs an internet
connection to make a video**; without one, the page and the plugin say so and stop. Only the name of the
piece being fetched is sent (for example "skill"): never your site, your key, your story or anything about
you.

<!-- The example video goes here: made by this plugin, from one real run. -->

## Two ways in

**In Claude Code (the plugin).** Add the plugin, then ask for a video:

```
/plugin marketplace add TryClapper/clapper
/plugin install clapper@clapper
```

Then type something like `make a launch video for mysite.com`. Claude checks your tools, reads the site,
shows you the storyboard before it builds anything, then renders the video into a new folder next to where
you're working. Ask for changes in the same chat; each render is kept as a numbered version. If a video
stops part way, ask Claude to continue it: it works out from the video's folder which step was finished last
and carries on from there.

**On a local page (no Claude Code needed).** Clone the repo and start it:

```
git clone https://github.com/TryClapper/clapper.git
cd clapper
node app/start.mjs
```

The page opens at `http://127.0.0.1:4317`. Paste your Claude API key, enter your site's address, pick the
length, and watch it build. You can change the storyboard before the build starts, ask for a fix afterwards,
and go back to any earlier version. Cancel always works, and you can close the tab: the video keeps building
as long as Clapper is running in your terminal.

Videos are made with Claude Opus 5.5, the same model the hosted app uses. A video costs about $4–5 for 30
seconds and about $8–10 for 60 seconds; Anthropic bills this to your Claude key.

Both need [Node 20 or newer](https://nodejs.org), [ffmpeg](https://ffmpeg.org) and Python 3 (the local page
needs Python 3.13 or newer; it finds `python3.13` or a uv-installed Python by itself). If one is missing, the start command (or Claude, in the plugin) says which one
and how to install it. It runs on macOS and Linux; on Windows, use WSL.

## Open source or hosted

The hosted app at [tryclapper.co](https://tryclapper.co) makes the same videos without any setup, and adds
more. This is what each one has:

| | Open source (free) | Hosted (pay as you go) |
|---|---|---|
| Styles | A limited set | More styles, plus the product walkthrough and Spotlight; you pick |
| Animated scenes in your site's own look, music and sound effects | Yes | Yes |
| Where it renders | On your computer, as an mp4 you can open in Remotion Studio | On our machines |
| Story editor, "Ask for a fix" and versions | Yes, on your computer (fixes run on your own Claude) | Yes |
| Edit panel (change text, numbers, colours and fonts by hand, then render again) | No | Yes |
| Feature videos (a video about one feature) | No (product videos only) | Yes |
| Voiceover | No | Yes |
| Newspaper and article cards, clippings | No | Yes |
| Hook, problem, fix with the product walkthrough | No | Yes |
| Teams, notify (Slack, webhooks), API and MCP | No | Yes |
| What you need | Node, ffmpeg and Python on your computer, and an internet connection (Clapper sends the video instructions) | A web browser |
| Who pays for the AI | You, on your own Claude key or Claude Code login | Included in your credits: no Claude account needed |

## Your key stays on your computer

The local page keeps your Claude API key in `app/.env` on your computer (that file is never committed). It
sends the key only to Anthropic's API, never shows it again in full after you save it, and never writes it
into a video folder or a log. The page listens on `127.0.0.1` only. Each start makes a new random pass that
only the browser it opens holds, so no other program on your computer can use the page to spend your key (to
open the page by hand, start it with `CLAPPER_TOKEN=<a secret of yours>` and open
`http://127.0.0.1:4317/?token=<that secret>`). Nothing about you is sent to us: there's no telemetry and no
account, and fetching the instructions sends only the piece's name.

Claude works inside each video's own folder. It runs only the kit's own scripts, Remotion and ffmpeg, never
installs anything, and treats the text on your site as data, not instructions.

## What's in here

- `skills/launch-video/` and `scripts/clapper_get.py`: the plugin's skill, which fetches Clapper's
  instructions and follows them, and the small script that fetches them, puts the kit's guides (KIT.md,
  DESIGN.md, STYLES.md) into each video's folder and works out where a stopped video left off.
- `kit/`: the video kit, a [Remotion](https://www.remotion.dev) project with the scenes, the Pile, Tangle and Dilemma
  styles, and scripts to capture a site, embed fonts and make the music.
- `app/`: the local page and its small server.
- `engine/`: the shared Python behind the local page (story checks, progress, versions).

## Licenses

Clapper Open Source's code is licensed under the [GNU Affero General Public License v3.0](LICENSE): you can
use it, change it and share it. If you run a changed copy as a service for other people, you must publish your
changes under the same license. The instructions service (tryclapper.co) is run by Clapper and isn't part
of this repo.

**Remotion has its own license, and it isn't open source.** Remotion is free for individuals, for-profit
companies with up to 3 employees, and non-profits. Larger companies need a paid Remotion company license to
make videos with it, including with this kit. See [remotion.dev/license](https://www.remotion.dev/license). The fonts are under
the SIL Open Font License, and the music is made by the kit's own code.
