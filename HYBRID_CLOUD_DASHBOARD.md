# Hybrid Cloud Dashboard (Local POS + Firebase + Vercel)

This repo supports a **hybrid architecture**:

- **Shop (local)**: Express + SQLite stays the source of truth.
- **Cloud**: local backend pushes **read-only snapshots** to **Firebase Firestore**.
- **Dashboard UI**: React app can run in **Firebase mode** and read those snapshots (deploy to Vercel).

No images are required for the cloud dashboard flow.

---

## 1) Firestore document layout (written by local backend)

All documents live under:

`shops/{shopId}/public/*`

Written docs:

- `exchangeRates`
- `checkInventory`
- `dashboardOverview`
- `reportsSummary`
- `reportsTrends`
- `inventoryMonthly_YYYY-MM`
- `meta`

These doc IDs are hard-coded in:

- `backend/src/cloud/syncToFirestore.js`
- `frontend/src/cloud/firestoreDocs.ts`

---

## 2) Local backend → Firestore sync

### Install + run backend

Backend dependencies now include Firebase Admin (`firebase-admin`).

### Required environment variables (shop machine)

Set these on the **shop machine** (never in Vercel):

- `BLUECUTS_SHOP_ID`: Firestore shop ID (string). Example: `bluecuts-main`
- `BLUECUTS_CLOUD_SYNC_SECRET`: secret string used to protect the sync endpoint.

Firebase Admin credentials (pick one):

- **Recommended**: copy the service account JSON to `%AppData%\Blue Cuts\firebase-service-account.json` (auto-detected on Windows)
- Or: `FIREBASE_SERVICE_ACCOUNT_PATH` = path to that JSON on **this PC** (not the developer’s path)
- Or: `GOOGLE_APPLICATION_CREDENTIALS` = path to that JSON (standard)
- Or: `FIREBASE_SERVICE_ACCOUNT_JSON` = JSON string (only if you really know what you’re doing)

Put env vars in **either**:

1. `backend/.env` (dev / manual install), or  
2. `%AppData%\Blue Cuts\cloud-sync.env` (recommended for **installed** Blue Cuts — survives app updates)

See `backend/cloud-sync.env.example`. **Restart the app** after changing env files.

If sync fails with *“Unable to detect a Project Id”*, this PC has **no valid Firebase key** — the JSON file is missing or `FIREBASE_SERVICE_ACCOUNT_PATH` points to a path that only exists on another computer.

### Trigger sync

The backend exposes:

`POST /api/cloud/sync`

Headers:

- `x-bluecuts-sync-secret: <BLUECUTS_CLOUD_SYNC_SECRET>`

Optional JSON body (to sync a specific month’s report doc):

```json
{ "year": 2026, "month": 4 }
```

If you don’t pass a body, it syncs the current month.

### Helper script included (Windows / PowerShell)

This repo includes a helper script:

- `backend/scripts/cloud-sync.ps1`

You can run it from the backend folder after setting env vars:

```powershell
cd "E:\Projects\Blue Cuts Gems\backend"

$env:BLUECUTS_SHOP_ID="bluecuts-main"
$env:BLUECUTS_CLOUD_SYNC_SECRET="change-me-to-a-long-random-secret"
$env:FIREBASE_SERVICE_ACCOUNT_PATH="C:\bluecuts\keys\firebase-service-account.json"

npm run start
```

Then (in another terminal):

```powershell
cd "E:\Projects\Blue Cuts Gems\backend"
npm run cloud-sync
```

To sync a specific month:

```powershell
cd "E:\Projects\Blue Cuts Gems\backend"
.\scripts\cloud-sync.ps1 -Year 2026 -Month 4
```

### Scheduled sync (Windows Task Scheduler)

Use `backend/scripts/manage-cloud-sync-task.ps1` to create or remove tasks under the current Windows user. The tasks run `cloud-sync.ps1`, which posts to your local API (default `http://127.0.0.1:4000`).

From the `backend` folder:

| Command | Meaning |
|--------|---------|
| `npm run cloud-sync:task-register` | Register **hourly** and **daily** (default daily time **2:00 AM**) |
| `npm run cloud-sync:task-hourly` | Register **hourly** only |
| `npm run cloud-sync:task-daily` | Register **daily** only |
| `npm run cloud-sync:task-list` | Show task status / next run |
| `npm run cloud-sync:task-unregister` | Remove both tasks |

Examples (PowerShell):

```powershell
cd "E:\Projects\Blue Cuts Gems\backend"

# Hourly + daily at 2:00 AM (same as npm run cloud-sync:task-register)
.\scripts\manage-cloud-sync-task.ps1 -Action Register -Schedule Both

# Daily only, at 1:30 AM
.\scripts\manage-cloud-sync-task.ps1 -Action Register -Schedule Daily -DailyAt "1:30 AM"

# If the API port or host differs
.\scripts\manage-cloud-sync-task.ps1 -Action Register -Schedule Both -BaseUrl "http://127.0.0.1:4000"
```

**Requirement:** When a task runs, the **local Express API must be listening** (Blue Cuts running, or `npm start` in `backend`). Otherwise that run fails until the next attempt.

### Manual sync

1. **Blue Cuts (Electron):** menu **Tools → Sync cloud dashboard (Firebase)…** — reads `backend/.env` for `BLUECUTS_CLOUD_SYNC_SECRET` and calls `POST /api/cloud/sync` on `127.0.0.1` (port from `PORT` or `4000`).
2. **Terminal:** `npm run cloud-sync` from `backend`, or double‑click **`backend/scripts/cloud-sync.cmd`**, or run **`cloud-sync.ps1`** directly.

---

## 3) Firebase console setup (you do this part)

### Create project

In Firebase Console:

- Create a project
- Enable **Firestore**
- Enable **Authentication** (Email/Password is simplest)

### Create “dashboard” users

Create at least one dashboard user account in Firebase Auth.

### Service account key (for shop machine)

Generate a service account JSON key and place it on the shop machine.
Point `FIREBASE_SERVICE_ACCOUNT_PATH` at it.

---

## 4) Firestore Security Rules (template)

Goal:

- Dashboard users can **read** snapshot docs
- No one can write from the browser

You’ll need your own shop/user mapping strategy. The simplest (owner-only) approach is:

- Put the shop ID in the UI env as `REACT_APP_SHOP_ID`
- Allow any authenticated user to read that shop’s public docs

Example rules (tighten for multi-tenant):

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /shops/{shopId}/public/{docId} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

If you want **per-user shop scoping**, add a `users/{uid}` doc with `shopId` and enforce it in rules.

---

## 5) Frontend “Firebase mode” (Vercel)

### Install

Frontend now depends on `firebase`.

### Enable Firebase mode

Set env in Vercel (or in `.env` locally):

- `REACT_APP_DATA_SOURCE=firebase`
- `REACT_APP_SHOP_ID=<same as BLUECUTS_SHOP_ID>`
- `REACT_APP_FIREBASE_API_KEY=...`
- `REACT_APP_FIREBASE_AUTH_DOMAIN=...`
- `REACT_APP_FIREBASE_PROJECT_ID=...`
- `REACT_APP_FIREBASE_STORAGE_BUCKET=...` (optional but included in config)
- `REACT_APP_FIREBASE_MESSAGING_SENDER_ID=...` (optional but included)
- `REACT_APP_FIREBASE_APP_ID=...`

These Firebase web config values come from Firebase Console → Project settings → Your apps → Web app.

### What the UI does in Firebase mode

- App shows an **email/password** login (Firebase Auth).
- Pages read Firestore snapshot docs and render the same UI components.

Current limitations in Firebase mode (by design of one-way snapshot):

- **Reports date range** and **grouping** controls are disabled (reads the last synced snapshot range).
- **Check Inventory stock history** per item isn’t synced (panel will show a note).
- **Monthly inventory report** reads `inventoryMonthly_YYYY-MM`. If you need older months, run sync for those months.

---

## 6) Deploy

### Vercel

- Deploy `frontend/`
- Add the env vars above
- Build command: `npm run build`
- Output: `build`

### Shop machine

- Run the backend (Electron build or `npm start` in `backend`).
- Keep Firestore updated using **Task Scheduler** and/or **manual sync** as described in *Scheduled sync* and *Manual sync* above (or call `POST /api/cloud/sync` yourself).

