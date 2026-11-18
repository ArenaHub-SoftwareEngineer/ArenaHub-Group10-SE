# Firestore Read and Write Budget

Written 12 Nov 2026 for the Phase 1 data layer. The figures are estimates from the listener code, not measurements. Prices are marked UNVERIFIED where Google's own table could not be confirmed.

## How Firestore bills

- **Reads are billed per document, not per byte.** A listener pays one read when it starts for each document it returns, and one read each time a document it watches changes.
- Bandwidth (network egress) is billed separately, by bytes.
- Spark (free) plan limits: **50,000 reads, 20,000 writes and 20,000 deletes per day, 1 GiB stored, 10 GiB egress per month** ([firebase.google.com/pricing](https://firebase.google.com/pricing), checked 12 Nov 2026).

### What changed from the single-document model, and what did not

The old model kept every published bracket in one `arenahub/brackets` document. **It was already cheap in reads:** one read per viewer per score update, because only one document changed. Its real problems were:

1. **Bandwidth.** Every score update re-downloaded every tournament with every roster (about 150 to 300 KB) to every viewer. At 2,000 viewers and 100 updates that is 30 to 60 GB, far over the 10 GiB monthly egress allowance.
2. **The 1 MiB document cap,** shared by all games plus the previous versions.
3. **Write contention.** All organizers on all games wrote to one document, and one stale tab could block everyone.

The new model (one document per tournament, plus one roster document per tournament) keeps **one read per viewer per update**, but each update now downloads only the changed tournament (about 15 KB for a 16-team bracket, with no rosters). Each game has its own 1 MiB limit, and organizers on different games never collide.

A separate "live board" document, which the original plan proposed, would **not** reduce reads in this model: viewers already pay one read per update. It is therefore not built. If bandwidth becomes the limit, it can be added later for the home page only.

The persistent offline cache is deliberately **off**. It would store staff-only rosters (student IDs, emails) on shared lab computers, and it would save only about 10 reads per page reload.

## Per-viewer cost

N = published tournaments (one per game, normally 3 or 4).

| What | Reads |
|---|---|
| Page load: tournaments + rosters | 2N (about 8) |
| Page load: catalog + spotlight items | 1 + up to 10 |
| Page load: announcements (limit 20) + personal inbox (limit 30) + own profile | up to 51 (lowered from 151 in Phase 1) |
| **Typical page load** | **about 40, at most 70** |
| Opening a live match chat (last 60 messages) | up to 60 |
| Opening the Player leaderboard: archived tournaments + their rosters (A = past events) | 2A, then 1 only when an event is archived or restored |
| Each score, status or schedule save in any tournament | 1 |
| Each public announcement (result, schedule change, match going live) | 1 |
| Each chat message while the chat is open | 1 |

The leaderboard listens to archived tournaments only while that page is open, and it adds nothing to other pages. A grows with the number of past events, not with viewers, so it stays small; if it ever grows into the dozens, a per-game summary document would replace this listener.

Writes per organizer action: 1 for the tournament, plus 1 per announcement it creates. A chat message is 2 writes (the message plus its private author record).

## Scenarios against Spark (50,000 reads per day)

| Scenario | Reads per viewer | Viewers Spark can serve per day |
|---|---|---|
| Idle visit (one page load) | about 40 | about 1,250 |
| Watch a 2-hour event: 60 updates, 20 announcements, no chat | about 120 | about 410 |
| Same event with chat open: 600 messages | about 780 | about 64 |

**Conclusion:** Spark fits the defense demo, practice sessions and small events (dozens of active chatters, a few hundred viewers without chat). It cannot host a 1,000-viewer final with live chat. No data model fixes this, because chat costs one read per viewer per message.

## Finals on Blaze: 2,000 viewers, 2 hours

Assumptions: 100 score or status saves, 30 announcements, 1,000 chat messages, every viewer has the chat open.

| Item | Count |
|---|---|
| Reads per viewer | 40 + 60 + 100 + 30 + 1,000 = 1,230 |
| Total reads | about 2.46 million |
| Billable reads (after 50,000 free) | about 2.41 million |
| Writes | about 100 + 30 + 2,000 = 2,130 (within the free 20,000) |
| Egress | about 3 GB (tournament updates) + 0.6 GB (chat) + 0.6 GB (page loads) = about 4.2 GB (within the free 10 GiB per month) |

**Estimated cost:** 2.41 million reads x **$0.03 to $0.06 per 100,000** = **about $0.72 to $1.45** per final.
The per-read price is **UNVERIFIED**: Google's pricing table did not load during research, and secondary sources disagree on $0.03 (single region) versus $0.06 (multi-region). Confirm it on [cloud.google.com/firestore/pricing](https://cloud.google.com/firestore/pricing) for the database's actual location.

Blaze requires a card. Set a budget alert; alerts notify but do not stop spending.

## Free-tier fallback for finals

- Keep ArenaHub chat for signed-in campus students, and point general viewers to the YouTube or Facebook native chat on the stream.
- Use slow mode (Phase 2), which caps messages per user. Total messages still grow with the number of chatters.
- The scoreboard, bracket and schedule stay within Spark limits for about 400 viewers per event day.
