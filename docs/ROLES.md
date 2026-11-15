# Staff roles

ArenaHub decides who is staff from Firebase **custom claims** on the account. A person's profile, email or display name never grants access. The rules in `firestore.rules` read two claims:

| Claim | Effect |
|---|---|
| `admin: true` | Full staff access, including account status changes |
| `role: "organizer"`, `"school-admin"`, `"moderator"` or `"admin"` | Staff access: brackets, results, Battle Royale, chat moderation, reports, fair play |

Every staff action also requires a verified school-domain account whose ArenaHub status is `active`.

## Roles

| Role | Meant for |
|---|---|
| `admin` | The project owner. Sets `admin: true` as well. |
| `school-admin` | The school's esports coordinator |
| `organizer` | Tournament organizers and facilitators who publish brackets and enter results |
| `moderator` | Chat and report moderators |

All four roles currently get the same permissions in the rules, apart from account status changes, which need `admin`.

## Granting and revoking

The person must sign in to ArenaHub once, so their account exists.

```powershell
# Local emulators (npm run demo or the test emulators)
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9098"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085"
npm run set-role -- organizer@wmsu.edu.ph organizer
npm run set-role -- organizer@wmsu.edu.ph --show
npm run set-role -- organizer@wmsu.edu.ph none
```

For the real project you need a service-account key and both confirmation flags. Without them the script refuses to run:

```powershell
Remove-Item Env:FIREBASE_AUTH_EMULATOR_HOST -ErrorAction SilentlyContinue
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\keys\arenahub-service-account.json"   # outside the project folder
npm run set-role -- coordinator@wmsu.edu.ph school-admin --project <project-id> --confirm-production
```

Download the key from Firebase Console → Project settings → Service accounts → Generate new private key. Keep it outside the repository; `.gitignore` also blocks `service-account*.json` and `*-service-account.json` as a second guard. Delete the key when you are done.

## What happens

- Only the `admin` and `role` claims change. Other claims stay.
- Changing someone's role from `admin` to a lower one removes `admin: true`.
- Revoking, or downgrading from `admin`, ends the person's sessions. An ID token that was already issued can stay valid for up to an hour; to remove someone at once, also set their ArenaHub status to `banned` on the Users page.
- A newly granted role applies the next time the person signs in, or within an hour.
- Each change writes an audit event (`actorId: "cli:set-role"`) naming the account by its id, not its email.
