# Design assets

ArenaHub uses **no AI-generated pictures**. There are two kinds of imagery:

1. **Official game art** (heroes, maps, key art) from each publisher, so the games look exactly like the games.
2. **Everything else is made in code:** the 3D arena (React Three Fiber), the landing-page previews built from real ArenaHub interface pieces, and the player background. Nothing needs generating.

## 1. Official game art: what to add

Only one slot is still open: a **portrait cover per game** for Home > Games. Until a file exists, the cover uses the game art already in `public/` (`fairplay-mlbb.webp`, `fairplay-dota2.jpg`, `fairplay-codm.webp`).

| File (save in `public/media/games/`) | Game | What to pick |
|---|---|---|
| `mlbb.webp` | Mobile Legends: Bang Bang | Official key art or a hero splash from the current season |
| `dota2.webp` | Dota 2 | Official hero artwork or loading-screen art |
| `codm-mp.webp` | Call of Duty: Mobile, Multiplayer | Official season key art featuring operators |
| `codm-br.webp` | Call of Duty: Mobile, Battle Royale | Official Battle Royale key art (map or drop scene) |

**Format:** portrait 3:4, at least 900 x 1200 px, WebP at about 80% quality. Choose art whose main subject sits in the middle, because the card crops the edges. Avoid art with large text baked in.

### Where to get it

Use the publishers' own channels, not fan sites or wallpaper aggregators, so the art is genuine and current.

- **Mobile Legends (Moonton):** official news posts on [en.moonton.com](https://en.moonton.com/news/316.html) often end with a **"Media assets are available here"** link to Moonton's press assets ([example](https://en.moonton.com/news/308.html)). Moonton's official social pages also post season key art.
- **Dota 2 (Valve):** the official site [dota2.com](https://www.dota2.com) has hero pages with official artwork. Valve also publishes guidelines for [team fan content](https://www.dota2.com/majorsregistration/content), which shows how it treats community use of Dota art.
- **Call of Duty: Mobile (Activision):** Activision's own launch press release points press to [callofduty.com/mobile](https://investor.activision.com/node/32841) and the official YouTube and social channels. Season key art is posted there.

### Using it responsibly

- ArenaHub shows the art for **non-commercial coverage of school tournaments**, which is how campus esports pages normally use game art. The footer on Home and on the welcome page credits it: "Game art © Moonton, Valve and Activision, shown for school tournament coverage." (`GAME_ART_CREDIT` in `src/components/common/GameCover.tsx`).
- Do not edit the art into new logos, merchandise or anything sold.
- If the school wants written certainty for a public launch, ask the publishers' community or esports teams for permission. Each publisher has a contact on its press pages.

## 2. Made in code (nothing to generate)

| Where | What it is | Source |
|---|---|---|
| Home and welcome page hero | Interactive 3D stage with the ArenaHub shield (drag to spin, tap to pulse) | `src/components/three/ArenaStage.tsx` |
| Still for devices without 3D | A render of that same 3D stage | `public/media/hero-stage.webp` |
| Welcome page feature cards | Real interface pieces: a live match card, a bracket that draws its winning path, the pre-match checklist ticking off | `src/components/auth/LandingPreviews.tsx` |
| Match player with no video yet | The 3D stage, dimmed, behind "Broadcast starting soon" | `src/components/common/BroadcastPlayer.tsx` |
| Live match thumbnails | The broadcast's own YouTube thumbnail, else the official game art | `src/lib/streamUtils.ts` (`broadcastThumbnails`) |

### Re-rendering the 3D still

If the brand colour or the 3D scene changes, render a new `public/media/hero-stage.webp` from the live scene (a Playwright screenshot of `.ah-stage` on the welcome page, converted to WebP). The colour comes from `institution.config.json` > `theme.primary`.
