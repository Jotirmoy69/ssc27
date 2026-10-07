# Prompt for Cloudflare Worker agent (Google auth + ownership)

Copy everything below the line into the agent that maintains `lib/workers.js` / the School Memories Worker.

---

## Context

The React frontend (School Memories album site) now uses **Google Identity Services** only. It sends the Google **ID token (JWT)** as:

```http
Authorization: Bearer <google-id-token>
```

There is **no database**. Persistence stays in **Backblaze B2** (S3-compatible), including the existing WebP sidecars:

- Photos: `photos/{timestamp}-{uuid}-{name}.webp`
- Album store: object name containing `sm-albums.webp` (1×1 WebP + trailing JSON after `\n<!--SMALBUMS-->`)
- Descriptions store: `sm-descriptions.webp` (marker `<!--SMDESC-->`)

Do **not** add D1/KV/Durable Objects unless absolutely necessary. Store ownership on **B2 object metadata** and inside the **album sidecar JSON** (frontend already writes ownership into the sidecar).

### Required Worker env vars

| Name | Purpose |
|------|---------|
| `GOOGLE_CLIENT_ID` | Same Web client ID as frontend `VITE_GOOGLE_CLIENT_ID` |
| `ADMIN_EMAIL` | Exact admin Google email (case-insensitive compare) |
| Existing B2 vars | Keep `B2_ENDPOINT`, `BUCKET_NAME`, `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY` |
| `ADMIN_PASSWORD` | Optional: keep for the Worker’s own HTML admin page only |

CORS already allows `Authorization`. Keep that.

---

## 1) Verify Google ID tokens

Add a helper that:

1. Reads `Authorization: Bearer …`
2. Verifies the JWT against Google’s JWKS (`https://www.googleapis.com/oauth2/v3/certs`)
3. Checks:
   - `aud` === `env.GOOGLE_CLIENT_ID`
   - `iss` is `accounts.google.com` or `https://accounts.google.com`
   - `email_verified` is true
   - `exp` is in the future
4. Returns `{ sub, email, name, picture }` or 401

Cache JWKS in memory for ~1 hour.

Treat a user as **admin** when `email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase()`.

---

## 2) Lock down `POST /api/upload`

**Require** a valid Google ID token (401 if missing/invalid).

Behavior:

1. Verify token → get `sub`, `email`, `name`.
2. Accept WebP only, ≤ 1 MB (same as today).
3. Put object to B2 under `photos/…` **or** allow sidecar names:
   - `sm-albums.webp`
   - `sm-descriptions.webp`
   (frontend still uploads these via `/api/upload` until dedicated album routes exist)
4. On photo objects (not sidecars), set S3/B2 user metadata, e.g.:
   - `x-amz-meta-owner-id` = Google `sub`
   - `x-amz-meta-owner-email` = email
   - `x-amz-meta-owner-name` = name (optional)
5. Response (201) should include at least:

```json
{
  "key": "photos/…",
  "url": "/api/image?key=…",
  "ownerId": "<sub>",
  "ownerEmail": "<email>"
}
```

(`ownerEmail` in the upload response is fine for the uploader themselves.)

---

## 3) Change `POST /api/delete` (critical)

Today delete only accepts `ADMIN_PASSWORD`. Change it so:

**Auth:** valid Google ID token (preferred). Optionally still accept `ADMIN_PASSWORD` for the Worker HTML page.

**Body:** `{ "key": "photos/…" }` (same validation: must start with `photos/`, no `..`).

**Authorization rules:**

1. Load object metadata from B2 (HEAD).
2. Allow delete if:
   - caller email is `ADMIN_EMAIL`, **OR**
   - `x-amz-meta-owner-id` === caller `sub`
3. Otherwise 403.
4. Objects with **no** owner metadata = legacy → **admin only**.

Return `{ "deleted": true }` on success.

---

## 4) Optional but recommended: album sidecar APIs

Frontend currently read-modify-writes `sm-albums.webp` from the browser (race-prone, forgeable). Prefer moving writes to the Worker so ownership cannot be spoofed.

### Album JSON shape (frontend already uses this)

```ts
type PhotoEntry = {
  url: string;           // usually "/api/image?key=photos/…"
  ownerId: string;       // Google sub
  ownerEmail: string;    // store always; return only to admin
  ownerName?: string;
  uploadedAt: string;    // ISO
};

type StoredAlbum = {
  id: string;
  person: string;
  cover: string;
  photos: PhotoEntry[];  // migrate legacy string[] → PhotoEntry with ownerId "legacy"
  createdAt: string;
  createdBy?: { id: string; email: string; name?: string };
};
```

Sidecar format unchanged: tiny WebP bytes + `\n<!--SMALBUMS-->` + `JSON.stringify(albums)`.

### Suggested routes

#### `GET /api/albums`

- Public.
- Read latest `*sm-albums.webp*` from B2, parse JSON.
- If request has a valid Google token **and** admin email → return full `ownerEmail` / `ownerName`.
- Otherwise strip `ownerEmail` and `ownerName` (and `createdBy.email`) before responding.
- Normalize legacy `photos: string[]` to `PhotoEntry` with `ownerId: "legacy"`.

#### `POST /api/albums`

Create album. Require Google token.

Body:

```json
{ "person": "Name", "cover": "/api/image?key=…" }
```

Worker sets `createdBy` from the verified token, prepends album, rewrites sidecar. Return the new album.

#### `POST /api/albums/:id/photos`

Append photos. Require Google token.

Body:

```json
{ "photos": ["/api/image?key=…", "…"] }
```

Worker stamps each new `PhotoEntry` with the caller’s `sub` / email / name / `uploadedAt`, appends, rewrites sidecar.

#### `DELETE /api/albums/:id/photos`

Remove photo from album **and** delete B2 object when allowed.

Body:

```json
{ "url": "/api/image?key=…" }
```

or `{ "key": "photos/…" }`.

Rules: owner of that photo **or** admin. Then update sidecar + DELETE object.

If you implement these, the frontend can be switched from client-side sidecar writes to these routes in a follow-up.

---

## 5) `GET /api/me` (small, useful)

Require Google token. Return:

```json
{
  "id": "<sub>",
  "email": "<email>",
  "name": "<name>",
  "isAdmin": true
}
```

---

## 6) Keep public GETs

Do **not** require auth for:

- `GET /api/images`
- `GET /api/image`
- `GET /api/storage`
- `GET /` (Worker HTML page)

Browsing stays open; only mutations require Google login.

---

## 7) Acceptance checks

1. Upload without `Authorization` → **401**.
2. Upload with valid Google JWT → **201** + owner metadata on object.
3. User A cannot delete User B’s photo → **403**.
4. User A can delete own photo → **200**.
5. `ADMIN_EMAIL` user can delete any photo → **200**.
6. Non-admin album responses never include other users’ emails (if `GET /api/albums` is implemented).
7. Sidecar uploads (`sm-albums.webp` / `sm-descriptions.webp`) still work for signed-in users.

---

## Frontend contract (already implemented)

- Env: `VITE_GOOGLE_CLIENT_ID`, `VITE_ADMIN_EMAIL`
- `+` buttons open a login modal if signed out
- Uploads send `Authorization: Bearer <id_token>`
- Deletes call `POST /api/delete` with the same header, then remove the URL from the album sidecar
- Admin UI shows “Uploaded by …” from sidecar fields; normal users have those fields redacted in the client

Implement the Worker side against this contract. Prefer metadata + sidecar in B2 only—no database.
