# PRD: stuff

## 1. Product overview

### 1.1 Document title and version

- PRD: stuff
- Version: 0.1
- Status: Draft approved for implementation planning
- Last updated: 2026-07-13
- Production URL: `https://stuff.piszek.com`
- Production hosting: GitHub Pages

### 1.2 Product summary

stuff is a mobile-first, visual home inventory application backed by a user-owned Google Sheet and Google Drive folder. It helps a household record what it owns, where each object is stored, what a container contains, and how to find an object later. The experience should feel as visual and inviting as Pinterest while keeping search, location context, and fast data entry more prominent than discovery or decoration.

The application is a static web app with no production build step and no application backend. Users authorize access with Google Identity Services. Inventory records are read from and written directly to Google Sheets, while private photos are uploaded to Google Drive. Public image URLs are supported as an alternative photo source.

The Sheet is a first-class interface rather than an opaque implementation detail. Users can browse and edit it manually, add rows without technical identifiers, reorder rows and columns, and retain custom columns. A versioned database abstraction inspects each connected Sheet, validates its structure, repairs safe schema drift, and performs backed-up migrations when future versions change the schema.

### 1.3 Product principles

- Search first: a user should be able to find an object before understanding the data model.
- Photo forward, not photo dependent: photos improve recognition, but every item remains usable without one.
- User-owned data: records and photos remain in the user's Google account.
- Sheet friendly: ordinary data entry must never require hidden or technical columns.
- Least privilege: the app requests access only to files created or explicitly selected for it.
- No-build simplicity: production assets run directly in modern browsers as HTML, CSS, and JavaScript modules.
- Safe evolution: schema changes are detected, backed up, versioned, and recoverable.
- English data contract: UI strings, tab names, headers, settings keys, and setup documentation are English in V1.

## 2. Goals

### 2.1 Business goals

- Deliver a reusable household inventory tool that can be hosted inexpensively as a static site.
- Avoid operating a custom database, file store, user system, or secret-bearing backend in V1.
- Make the project understandable and reusable by people beyond the initial household.
- Keep maintenance low by using browser standards and Google REST APIs instead of a framework-specific runtime.
- Establish a stable schema and migration foundation before adding AI-assisted recognition or other advanced features.

### 2.2 User goals

- Find an item in a few seconds by name, description, tag, container, or any ancestor location.
- Add an item with several photos from a phone in under one minute.
- Understand the contents and physical position of a container.
- Move a container without editing every item inside it.
- Use the application comfortably on a phone and desktop computer.
- Add or correct records directly in Google Sheets without filling technical fields.
- Share one inventory safely with another household member using separate Google accounts.
- Add private Drive photos or reference public photos by URL.
- Install the app on the home screen and launch it like a native utility.
- Trust that future application updates will not silently corrupt the Sheet.

### 2.3 Non-goals

- AI image recognition, OCR, conversational search, or OpenAI integration in V1.
- A custom backend, database server, refresh-token service, or server-side image proxy.
- Anonymous or public access to inventory records.
- Fully offline editing or a persistent offline photo upload queue.
- Inventory management for warehouses or catalogs larger than approximately 10,000 items.
- Barcode purchasing, financial valuation, depreciation, insurance reporting, or sales workflows.
- Real-time collaborative editing equivalent to Google Sheets.
- Automatic copying of externally hosted public images into Google Drive.
- Importing or migrating the existing Polish `RZECZY` spreadsheet; V1 starts with a new English database.
- Supporting arbitrary renaming of required Sheet tabs and required headers.
- Place types and item/place status or archive workflows in V1.
- Native iOS or Android applications.

## 3. User personas

### 3.1 Key user types

- Inventory owner
- Household editor
- Direct Sheet editor

### 3.2 Basic persona details

- Inventory owner: Sets up the inventory, owns the dedicated root Google Drive folder, may choose its parent location, shares access, manages schema upgrades, and maintains the structure of locations.
- Household editor: Uses a separately authorized Google account to search, add, photograph, and move objects in the shared inventory.
- Direct Sheet editor: Uses Google Sheets for bulk entry, corrections, sorting, filtering, or adding public photo URLs, without needing to understand generated identifiers.

### 3.3 Role-based access

- **Inventory owner**: Can create or connect the database, share the root folder, run migrations and repairs, manage all records and photos, and disconnect the inventory.
- **Household editor**: Has Google Drive `writer` access to the shared folder and can use all normal item, place, and photo features. Migration actions are available only when the editor can create a backup and modify the Sheet.
- **Direct Sheet editor**: Has the permissions granted in Google Drive. The app does not maintain a separate role database or override Google file permissions.
- **Unauthenticated visitor**: Can see the product connection screen and privacy information but cannot view inventory data.

## 4. Functional requirements

### 4.1 Google connection and access (Priority: Critical)

- FR-001: The app must use Google Identity Services' browser token model.
- FR-002: The app must request the `https://www.googleapis.com/auth/drive.file` scope and no broad Drive scope.
- FR-003: With `Remember access on this device` enabled, the app may persist the short-lived Google access token and its exact expiration time in localStorage. The token must be removed when expired, rejected by Google, disconnected, revoked, or replaced by another account. It must never be written to IndexedDB, Cache Storage, the service worker, the Sheet, logs, analytics, or URLs.
- FR-004: The app must remember the selected spreadsheet ID and non-sensitive UI preferences in localStorage. `Remember access on this device` defaults to enabled on first connection and can be disabled to use memory-only tokens.
- FR-005: When a token is missing or expired, a user action must reopen the Google authorization flow without discarding an in-progress form.
- FR-006: The app must support explicit session clearing and full consent revocation as separate actions.
- FR-007: Google API authorization errors must distinguish expired authorization, missing file permission, revoked access, and unavailable network.

### 4.2 Inventory onboarding (Priority: Critical)

- FR-008: First-time users must be able to create a new stuff database or select an existing compatible spreadsheet.
- FR-009: The primary `Create inventory` action must create a dedicated `stuff` folder directly in My Drive without requiring folder selection. An optional `Choose location…` action must let the user select a parent folder with Google Picker and then create the dedicated `stuff` folder inside it.
- FR-010: The app must always create its own dedicated root rather than treating an arbitrary existing folder as the stuff root. `Photos`, `Thumbnails`, the `stuff — Inventory` spreadsheet, and V1 tabs/settings must be created inside that root so sharing applies only to inventory content. The app must resolve these resources by stable Drive IDs and continue working after they are renamed or moved within My Drive; changed access, trash state, or Shared Drive boundaries must trigger validation and recovery guidance.
- FR-011: The owner must be able to share the root folder with another Google account as an editor.
- FR-012: A collaborator must be able to select the shared spreadsheet with Google Picker and remember it on that device.
- FR-013: V1 remembers one active inventory per browser profile. Switching requires the explicit `Disconnect inventory` action.

### 4.3 Search and browse (Priority: Critical)

- FR-014: The default route must be a search-focused visual inventory board.
- FR-015: Search must cover item name, description, tags, direct location, and all ancestor place names.
- FR-016: Search must be case-insensitive, accent-insensitive, whitespace-normalized, and tolerant of small typographical errors.
- FR-017: Ranking must prioritize exact name matches, then name prefixes, tags, location paths, and descriptions.
- FR-018: Users must be able to filter by place subtree and presence of photos.
- FR-019: Users must be able to switch between a Pinterest-inspired masonry grid and a compact list.
- FR-020: Item cards must display a cover image or placeholder, name, full location breadcrumb, and relevant tags.
- FR-021: Search and filtering must happen locally after the current dataset is loaded.

### 4.4 Item management (Priority: Critical)

- FR-022: Users must be able to create an item with only a name.
- FR-023: Optional item fields are location, description, tags, quantity, and photos.
- FR-024: Users must be able to edit and move an item.
- FR-025: V1 must not add an item status field or an archive workflow.
- FR-026: Item detail must display a photo gallery, location breadcrumb, metadata, and primary actions.
- FR-027: An item created manually in Sheets without an ID must be visible and receive generated metadata during the next successful synchronization.

### 4.5 Place and container management (Priority: Critical)

- FR-028: Places must form a tree in which each place has zero or one parent.
- FR-029: Places must not have a type field in V1; the same place model represents locations, rooms, furniture, and containers through names and hierarchy.
- FR-030: Places and containers may have descriptions and photos.
- FR-031: Moving a place must move its entire subtree and recalculate descendant and item paths.
- FR-032: The app must prevent cycles and invalid parent references when creating or moving a place.
- FR-033: A place added manually with only a name must remain valid and receive an ID on synchronization.
- FR-034: An ambiguous manually typed parent or item location must remain visible but be marked for user resolution rather than silently matched.

### 4.6 Photo management (Priority: Critical)

- FR-035: Users must be able to add photos from the phone camera, local gallery, or Google Picker. A Picker image must be imported as an app-owned copy in the shared stuff media folders so every inventory editor can access it; the source file remains unchanged.
- FR-036: New private photos must keep the original full-image bytes and EXIF metadata and be accompanied by an approximately 480-pixel web-compatible thumbnail. Generated thumbnails do not need to retain EXIF metadata.
- FR-037: Full images and thumbnails must upload sequentially to their respective private Drive folders using resumable uploads.
- FR-038: The relationship model must not impose a fixed maximum number of photos per item or place.
- FR-039: Photo order must be editable; the lowest order is the cover photo.
- FR-040: The app must warn before closing or navigating away during an active upload.
- FR-041: Successfully uploaded photos must remain attached if a later photo in the same queue fails.
- FR-042: The default remove action must delete the photo relationship row without deleting files. A separate `Delete files from Drive` action must require confirmation, check Drive capabilities, and move only the app-owned full image and thumbnail to trash.

### 4.7 Public image URLs (Priority: High)

- FR-043: Users must be able to add a public HTTPS image URL without copying the image into Drive.
- FR-044: Generic public URLs must be validated by loading them as images with `referrerpolicy="no-referrer"`.
- FR-045: Google Drive sharing URLs must be parsed for `fileId` and an optional resource key and tested for anonymous media access.
- FR-046: A Drive URL that is not anonymously readable must be rejected as a public URL and offered through Google Picker instead.
- FR-047: Broken external images must show a placeholder and a repair action without blocking the rest of the item.
- FR-048: A public URL entered manually in the `Photos` tab must be linked to an unambiguous item or place during synchronization.
- FR-049: `Cover Photo` may use `IMAGE()` only for compatible public non-Drive URLs; Drive sources must remain authenticated links.

### 4.8 Direct Sheet editing (Priority: Critical)

- FR-050: All V1 tab names, column names, and settings keys must be English.
- FR-051: No hidden column may be required for manual item or place creation. Declared human-editable columns must use native Google Sheets dropdowns and data validation wherever the Sheets API supports them.
- FR-052: Human-editable columns must appear before generated columns.
- FR-053: The app must identify columns by normalized header name rather than fixed column letter or position.
- FR-054: Reordering rows or columns must not break relationships.
- FR-055: Unknown user-created columns must be preserved through normal writes, repairs, and migrations.
- FR-056: Missing generated values must be backfilled without overwriting human-entered fields.
- FR-057: Missing generated columns may be recreated through `Repair sheet`; destructive repairs require explicit confirmation.
- FR-058: Renamed or missing required tabs and human-facing headers must cause a read-only schema warning instead of guessed writes.

### 4.9 Schema detection and migrations (Priority: Critical)

- FR-059: Every stuff database must declare `database_type=stuff` and an integer `schema_version` in `Settings`.
- FR-060: The app must inspect the connected spreadsheet before enabling writes.
- FR-061: Inspection must classify the database as current, upgradeable, interrupted, newer than the app, repairable, uninitialized, or unknown.
- FR-062: Schema definitions and migrations must be registered in application code as sequential integer versions.
- FR-063: Before a migration, the app must create a timestamped Drive copy of the spreadsheet and persist its file ID.
- FR-064: Migrations must be idempotent and resumable and must record their state in `Settings`.
- FR-065: Automatic migrations must preserve unknown tabs, columns, and user data and should be additive wherever possible.
- FR-066: A failed migration must disable writes and offer retry and backup access.
- FR-067: A database newer than the running app must open read-only and request an app update.
- FR-068: A `minimum_app_version` setting must prevent an outdated cached PWA from modifying an incompatible schema.

### 4.10 Synchronization and conflicts (Priority: High)

- FR-069: Stable UUIDs, not row numbers, must identify entities.
- FR-070: Before updating an existing entity, the app must refetch and locate its current row by ID.
- FR-071: The app must compare the current row with the snapshot loaded for editing, including human-editable values, because manual Sheet edits may not increment `Version`.
- FR-072: A conflicting edit must show a comparison and allow reload or explicit overwrite.
- FR-073: New item creation with photos must persist the item before beginning photo uploads so a partial upload cannot hide the item.
- FR-074: A diagnostic action must detect duplicate IDs, unresolved relationships, photo rows without entities, and unreferenced app-owned media.

### 4.11 Installability and application updates (Priority: High)

- FR-075: The app must provide a valid web app manifest, maskable 192- and 512-pixel icons, Apple touch metadata, and standalone display mode.
- FR-076: Supported browsers must receive an `Install stuff` action when installation is available.
- FR-077: iOS users must receive concise `Share → Add to Home Screen` instructions.
- FR-078: The service worker must cache only the same-origin application shell and must never cache Google API responses, tokens, or private photos.
- FR-079: When a new application version is ready, the app must offer a controlled reload.
- FR-080: If offline, the cached shell must explain that inventory access requires a Google connection; offline edits are not supported in V1.

### 4.12 Accessibility and responsive behavior (Priority: High)

- FR-081: All primary functionality must be usable by keyboard and screen reader.
- FR-082: Interactive targets must be at least 44 by 44 CSS pixels on touch devices.
- FR-083: Text and controls must meet WCAG 2.2 AA contrast requirements.
- FR-084: Status, upload progress, errors, and dialogs must not rely on color alone.
- FR-085: The masonry grid must preserve a sensible DOM and focus order.
- FR-086: The app must support current Safari on iOS and macOS, Chrome on Android and desktop, Edge, and Firefox.

### 4.13 XSS prevention and token containment (Priority: Critical)

- FR-087: Persisted credentials must use dedicated `stuff.googleAccessToken` and `stuff.googleAccessTokenExpiresAt` keys; no application-state object may contain a copy of the token.
- FR-088: A persisted token must be treated as invalid and removed at least 60 seconds before its declared expiration, and immediately after an authentication-related `401` response.
- FR-089: Sheet values, user input, filenames, place names, tags, descriptions, errors, and URLs must never be rendered as HTML. They must reach the DOM through `textContent`, form values, or narrowly validated element attributes.
- FR-090: Production code must not use `eval`, `new Function`, `document.write`, string-based timers, or dynamically generated script elements.
- FR-091: User-provided URLs must be parsed with the `URL` API, restricted to `https:`, and assigned only to the intended URL-bearing property. `javascript:`, `data:`, `blob:`, inline event handlers, and HTML fragments are not valid external photo inputs.
- FR-092: The production page must enforce a restrictive Content Security Policy that disallows inline scripts, `unsafe-eval`, arbitrary script origins, plugins, and untrusted frames while permitting only the same-origin application and required official Google origins.
- FR-093: V1 must include no third-party runtime JavaScript other than the official Google Identity Services and Picker libraries. It must not load remote fonts, analytics, tag managers, or UI libraries.
- FR-094: Automated security tests must exercise stored-XSS payloads from every human-editable Sheet field and fail on unsafe DOM sinks or executable markup.
- FR-095: The privacy and connection UI must disclose that remembering access improves convenience but allows any script executing on the application origin to use the token until it expires; users on shared devices can disable it.

## 5. User experience

### 5.1 Entry points and first-time user flow

- A user opens `https://stuff.piszek.com` in a browser or from a home-screen icon.
- The connection screen explains that data remains in Google Sheets and Drive and offers `Continue with Google`.
- After authorization, the user chooses `Create a new inventory` or `Choose an existing inventory`.
- New inventory creation defaults to a one-click dedicated `stuff` folder in My Drive. `Choose location…` optionally selects a parent folder, not the root itself.
- After creation, the app shows the generated folder and spreadsheet, offers `Open in Google Drive`, explains that the folder may be moved or renamed later, and offers to share it with a household member.
- Existing inventory selection uses a spreadsheet-filtered Google Picker.
- The app inspects the database before showing content. Current databases open immediately; repair or migration states show an explicit action and explanation.
- The selected spreadsheet ID is remembered. A later browser session resumes immediately while its remembered token remains valid; otherwise it requests a user-initiated Google reconnection without repeating inventory selection.

### 5.2 Core experience

- Search inventory: The app opens with focus available on a persistent search field and a visual board of items.
  - Results update locally as the user types and retain readable location breadcrumbs.
- Add item: The user opens `Add`, enters a name, selects or creates a place, and optionally adds text and photos.
  - The camera/gallery action is visually primary on phones but never blocks a text-only record.
- Browse places: The user navigates a location tree, opens a container, and sees its direct children and contained items.
  - Moving a container updates the effective location of everything inside it.
- Review item: The user opens a card to view the gallery, location, tags, quantity, description, and edit actions.
- Use Sheets directly: The user opens the spreadsheet for bulk changes, adds ordinary rows, and returns to the app for ID backfill and relationship resolution.

### 5.3 Advanced features and edge cases

- Token expiration while editing preserves all form fields and in-memory File objects while prompting for reconnection.
- Token expiration during a resumable upload allows the current queue to continue after reconnection where the upload session remains valid.
- A missing or moved spreadsheet opens a recovery screen with `Choose another inventory`.
- An inaccessible private image offers Google Picker rather than requesting broader Drive access.
- Ambiguous location names show candidate paths and require a choice.
- Broken public images show a stable placeholder and preserve their stored URL.
- Simultaneous edits show a conflict dialog rather than silently applying last-write-wins behavior.
- An interrupted migration reopens directly into migration recovery.
- An outdated service worker cannot write to a Sheet that declares a higher minimum application version.
- A manually deleted generated column leads to a non-destructive repair preview.

### 5.4 UI/UX highlights

- Pinterest-inspired masonry board with a compact list alternative.
- Warm ivory background, dark evergreen primary color, and terracotta accent.
- System font stack for speed and language coverage.
- Search remains visually dominant at every viewport size.
- Mobile bottom navigation and desktop sidebar use the same four information architecture destinations.
- Cards prioritize cover image, name, and physical location; technical metadata stays in details and Settings.
- Empty states provide a single relevant action, such as `Add your first item` or `Create a place`.
- Upload queues show per-photo progress, completed photos, retryable failures, and remaining count.

## 6. Narrative

A household member remembers owning an object but not where it was stored. They open stuff from their phone's home screen, type part of the object's name or a related tag, and immediately see a photo card with a breadcrumb such as `Mom's house / Basement / Shelf 2 / Maps box`. Later, while organizing that basement, they photograph another object, add it to the same container in under a minute, and know that both the friendly visual app and the underlying Google Sheet will remain useful, editable, and safely upgradeable.

## 7. Success metrics

### 7.1 User-centric metrics

- A returning authorized user can reach usable search results within 5 seconds on a typical mobile connection for an inventory of 2,000 items.
- Local search updates in under 150 milliseconds at the 95th percentile for 2,000 items.
- A user can create an item with a location and three photos in under 60 seconds, excluding network upload time.
- A manually created valid row appears in the app and receives an ID on the next synchronization without requiring the user to edit generated columns.
- At least 90% of common searches in the initial household produce the intended item within the first five results.
- Both intended household members can independently authorize and edit the same inventory.

### 7.2 Business metrics

- The app incurs no mandatory recurring application hosting, database, or image-storage cost beyond services already used by the owner.
- Another user can deploy a separate installation by following the repository setup guide without changing application source beyond public configuration.
- The initial household continues using the inventory through both the app and direct Sheet edits after four weeks.
- V1 requires no backend operations, secret rotation, or server maintenance.

### 7.3 Technical metrics

- A remembered Google token is present only in its two dedicated localStorage keys, is never usable after its expiration safety window, and never appears in IndexedDB, Cache Storage, service-worker caches, logs, URLs, or application snapshots.
- Stored-XSS test payloads covering every Sheet text field remain inert in search, cards, details, forms, diagnostics, conflicts, and migration previews.
- Lighthouse accessibility score is at least 95 on the search, item detail, and add-item routes.
- All schema inspection and migration fixtures pass, including interrupted and newer-schema cases.
- A migration test preserves all unknown columns and values byte-for-byte where they are not part of the migrated contract.
- Production JavaScript loads as native modules without a bundling or compilation step.
- The application shell is usable at 320 CSS pixels wide without horizontal scrolling.
- No uncaught error or partial schema write occurs in the documented authorization, network, migration, and conflict scenarios.

## 8. Technical considerations

### 8.1 Application architecture

The production application consists of static HTML, CSS, SVG/PNG assets, a web manifest, a service worker, and native JavaScript modules. A development-only package file may provide a local static server and tests, but deployment must not require generated assets.

Native Web Components provide component boundaries:

- `<stuff-app>` owns routing, high-level state, authentication state, and database connection.
- Page-level components use light DOM and the shared stylesheet.
- Reusable isolated controls such as `<stuff-item-card>`, `<stuff-dialog>`, and `<stuff-photo-picker>` may use Shadow DOM, with design tokens inherited through CSS custom properties.
- Components communicate through properties and composed custom events; they do not import the Google APIs directly.
- Services own Google authorization, Picker, REST requests, media processing, storage preferences, and database access.

Suggested repository structure:

```text
/
├── index.html
├── privacy.html
├── manifest.webmanifest
├── sw.js
├── CNAME
├── assets/
│   └── icons/
├── src/
│   ├── config.js
│   ├── main.js
│   ├── components/
│   ├── data/
│   │   ├── schema-registry.js
│   │   ├── sheet-database.js
│   │   ├── sheet-table.js
│   │   └── migrations/
│   ├── services/
│   ├── search/
│   └── strings/en.js
├── styles/
├── tests/
└── docs/
    └── prd.md
```

### 8.2 Integration points

- Google Identity Services: short-lived browser access tokens initiated by a user gesture.
- Google Picker API: explicit selection of an existing spreadsheet or private Drive image.
- Google Drive API v3: folders, spreadsheet file creation, sharing, file copies, metadata, uploads, downloads, and trash operations.
- Google Sheets API v4: spreadsheet metadata, values, formatting, validation, batch reads, batch writes, and schema changes.
- GitHub Pages: static hosting and custom domain TLS.
- Browser APIs: Web Components, Canvas/`createImageBitmap`, File API, Web App Manifest, Service Worker, Cache Storage for same-origin shell assets, and install prompt events.

Reference documentation:

- [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Drive per-file authorization](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Picker for web](https://developers.google.com/workspace/drive/picker/guides/web-picker)
- [Google Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Google Sheets values](https://developers.google.com/workspace/sheets/api/guides/values)
- [Google Sheets data validation](https://developers.google.com/workspace/sheets/api/samples/data#data-validation)

### 8.3 Google Cloud setup

Use one Google Cloud project named `stuff` for both development and production.

Setup:

1. Create a Google Cloud project named `stuff`.
2. Enable Google Drive API, Google Sheets API, and Google Picker API.
3. Configure the Google Auth platform as an external app named `stuff`.
4. Set the support email, homepage `https://stuff.piszek.com`, and privacy page `https://stuff.piszek.com/privacy.html`.
5. Add `piszek.com` as an authorized domain and verify domain ownership as required by Google.
6. Declare only `https://www.googleapis.com/auth/drive.file` for application data access.
7. Create one Web application OAuth client with `https://stuff.piszek.com` and `http://localhost:4173` as authorized JavaScript origins.
8. Create an API key for Google Picker, restricted to Google Picker API and HTTP referrers `https://stuff.piszek.com/*` and `http://localhost:4173/*`.
9. Record the OAuth client ID, restricted API key, and Cloud project number in the public application configuration.
10. During testing, add the two household accounts as test users; before general reuse, move the OAuth app to the appropriate production publishing state and complete required branding/basic verification.

OAuth client IDs and referrer-restricted browser API keys identify the public client and are not treated as server secrets. No client secret or OpenAI key may be committed or delivered to the browser.

### 8.4 Google Sheets database contract

The spreadsheet locale is `en_US`; stored timestamps are UTC ISO 8601 strings. Tab and header matching is case-sensitive for the declared V1 contract after normalization of surrounding whitespace. Column order is irrelevant.

#### Items tab

| Column | Type | Manual requirement | Ownership |
|---|---|---:|---|
| `Name` | String | Required | Human |
| `Location` | String path; dropdown from `Places.Path` | Optional | Human with app canonicalization |
| `Description` | String | Optional | Human |
| `Tags` | Comma-separated string | Optional | Human |
| `Quantity` | Positive number with numeric validation | Optional; defaults to 1 | Human |
| `Photo Count` | Integer | Never | App-derived |
| `Cover Photo` | Formula or hyperlink | Never | App-derived |
| `ID` | UUID | Never | App-generated |
| `Place ID` | UUID | Never | App-resolved |
| `Created At` | ISO timestamp | Never | App-generated |
| `Updated At` | ISO timestamp | Never | App-generated |
| `Version` | Integer | Never | App-generated |

#### Places tab

| Column | Type | Manual requirement | Ownership |
|---|---|---:|---|
| `Name` | String | Required | Human |
| `Parent` | String name/path; dropdown from `Places.Path` | Optional | Human with app canonicalization |
| `Description` | String | Optional | Human |
| `Path` | String path | Never | App-derived |
| `Photo Count` | Integer | Never | App-derived |
| `Cover Photo` | Formula or hyperlink | Never | App-derived |
| `ID` | UUID | Never | App-generated |
| `Parent ID` | UUID | Never | App-resolved |
| `Created At` | ISO timestamp | Never | App-generated |
| `Updated At` | ISO timestamp | Never | App-generated |
| `Version` | Integer | Never | App-generated |

#### Photos tab

| Column | Type | Manual requirement | Ownership |
|---|---|---:|---|
| `Entity Type` | `Item` or `Place` dropdown | Required for manual URL entry | Human/app |
| `Entity` | String name/path | Required for manual URL entry | Human/app canonicalization |
| `Source` | `Drive` or `URL` dropdown | Required for manual URL entry | Human/app |
| `URL` | HTTPS URL or Drive web link | Required for manual URL entry | Human/app |
| `Order` | Positive integer with numeric validation | Optional | Human/app |
| `Description` | String | Optional | Human |
| `ID` | UUID | Never | App-generated |
| `Entity ID` | UUID | Never | App-resolved |
| `Drive File ID` | String | Never | App-generated |
| `Thumbnail File ID` | String | Never | App-generated |
| `Created At` | ISO timestamp | Never | App-generated |

#### Native Sheet controls

The schema must apply native Google Sheets data-validation rules through `spreadsheets.batchUpdate` and `SetDataValidationRequest` wherever a human-editable field has a finite set or numeric constraint. Dropdown rules use `showCustomUi=true`:

- `Items.Location` uses a `ONE_OF_RANGE` dropdown sourced from the generated `Places.Path` range.
- `Places.Parent` uses a `ONE_OF_RANGE` dropdown sourced from the generated `Places.Path` range; root places may remain blank.
- `Photos.Entity Type` uses a `ONE_OF_LIST` dropdown containing `Item` and `Place`.
- `Photos.Source` uses a `ONE_OF_LIST` dropdown containing `Drive` and `URL`.
- `Items.Quantity` accepts positive numbers, and `Photos.Order` accepts positive integers.
- `Photos.Entity` remains readable text in V1. A type-dependent native dropdown would require generated helper ranges or fragile formulas, so diagnostics resolve and validate it instead.
- V1 validation rules use `strict=false` to show a warning for out-of-contract manual values rather than rejecting the edit. The app keeps such values visible and reports unresolved or invalid values through diagnostics.
- Database creation, schema repair, and migrations recreate missing validation only on declared V1 columns. User-created columns and their validation remain untouched.
- Validation source and target ranges are resolved from current header positions; they must not depend on fixed column letters.

This contract uses native Sheet dropdowns and validation as editing aids, while stable IDs and application diagnostics remain the source of relationship integrity.

#### Settings tab

`Settings` contains `Key`, `Value`, and `Description` columns. V1 recognizes these keys:

| Key | Required | Purpose |
|---|---:|---|
| `database_type` | Yes | Must equal `stuff` |
| `database_id` | Yes | Stable UUID for this inventory |
| `schema_version` | Yes | Integer schema version; initially `1` |
| `minimum_app_version` | Yes | Minimum compatible semantic app version |
| `migration_state` | Yes | `idle`, `running`, or `failed` |
| `migration_from` | During migration | Source schema version |
| `migration_to` | During migration | Target schema version |
| `migration_step` | During migration | Last completed idempotent step |
| `migration_backup_id` | During/after migration | Drive file ID of pre-migration backup |
| `root_folder_id` | Yes | Root Drive folder |
| `photos_folder_id` | Yes | Full-size image folder |
| `thumbnails_folder_id` | Yes | Thumbnail folder |
| `created_at` | Yes | Database creation timestamp |
| `updated_at` | Yes | Last structural update timestamp |

### 8.5 Database abstraction and schema lifecycle

`StuffSheetDatabase` is the only service allowed to expose the connected spreadsheet to application features. UI components consume domain objects and repositories rather than A1 ranges.

```text
StuffSheetDatabase.create(options)
StuffSheetDatabase.connect(spreadsheetId)
StuffSheetDatabase.inspect()
StuffSheetDatabase.repairSchema(plan)
StuffSheetDatabase.migrate(targetVersion)

database.items.list|get|create|update
database.places.list|get|create|move|update
database.photos.listFor|addDrive|addUrl|reorder|remove|deleteFiles
database.settings.get|set
```

`SheetTable` responsibilities:

- Read and normalize the header row.
- Map field names to current column indexes.
- Map row values to typed domain records.
- Locate mutable rows by UUID immediately before writing.
- Append records and batch updates without touching unknown columns.
- Backfill generated fields for manual rows.
- Return diagnostics for invalid values rather than silently deleting them.

`SchemaRegistry` contains immutable definitions for each version and a migration graph limited to sequential steps. A schema fingerprint validates required tabs and headers but ignores column order and unknown additions.

Connection behavior:

1. Read spreadsheet metadata and locate `Settings`.
2. Read database identity, schema version, migration state, and minimum application version.
3. Compare the Sheet against the registered schema fingerprint.
4. Enable normal writes only for a current, structurally valid database.
5. Offer a repair preview for safe, non-destructive drift.
6. Offer a backed-up migration for older supported versions.
7. Enter recovery for interrupted/failed migrations.
8. Enter read-only mode for newer or unknown schemas.

Migration behavior:

1. Validate that the user can read, copy, and edit the spreadsheet.
2. Create `stuff backup — schema v{from} — {timestamp}` in a `Backups` folder under the stuff root.
3. Persist `migration_backup_id`, source, target, state, and step.
4. Apply small idempotent steps, persisting progress after every step.
5. Reinspect the complete target schema.
6. Set the new `schema_version`, compatible `minimum_app_version`, `migration_state=idle`, and `updated_at`.
7. On failure, leave the original version unchanged where possible, set `migration_state=failed`, disable writes, and expose retry and backup links.

Automatic migrations must not delete unknown data. A future explicitly destructive migration requires a separate preview listing every affected tab, column, and row category.

### 8.6 Data synchronization and concurrency

- Initial loading uses batched reads for `Items`, `Places`, `Photos`, and `Settings`.
- All records are held in memory and indexed locally for the expected V1 scale.
- The app refreshes on explicit pull/refresh, when returning to a visible tab after a configurable stale interval, and before modifying an existing record.
- Editing begins with a snapshot of all known human fields.
- Before write, the database locates the current row by ID and compares it with the snapshot. `Version` is helpful but not sufficient because direct Sheet edits do not update it.
- Conflicts show current and proposed values. The user chooses reload or explicit overwrite.
- App writes use batch operations where changes must remain together, such as moving a place and updating paths.
- Manual rows without IDs receive UUIDs before relationships are created.
- Duplicate IDs are never silently reassigned when referenced; diagnostics require user resolution.

### 8.7 Photo storage and delivery

Private upload flow:

1. Generate the entity UUID and persist the item/place if it is new.
2. Read each selected File sequentially.
3. Keep the original file bytes, MIME type, and EXIF metadata unchanged for the full-image upload.
4. Decode the image with browser orientation handling only to generate an approximately 480-pixel web-compatible thumbnail.
5. Start resumable Drive uploads for the full and thumbnail files with the appropriate parent folder IDs.
6. Append a `Photos` relationship row after both uploads succeed.
7. Continue with the remaining queue; retain completed relationships on later failures.

An image chosen from Google Picker is copied into the inventory's shared `Photos` folder without re-encoding so its file content and embedded EXIF remain intact. The app generates a new thumbnail in `Thumbnails`. The original selected file remains untouched, and the inventory uses its own copy with the inventory folder permissions.

Private images are loaded with authorized Drive media requests and displayed using revocable Blob object URLs. Short-lived Drive thumbnail URLs are not persisted.

Public URL flow:

- Only `https:` is accepted.
- Generic URLs are loaded as images without a referrer. CORS is not required for display, but the image is not read into Canvas or sent to AI in V1.
- Recognized Drive links are parsed and tested anonymously. A resource key is preserved when supplied.
- An external host can remove or block an image at any time; the relationship remains and displays a repairable placeholder.

### 8.8 Data storage and privacy

- Inventory content stays in Google Sheets.
- Private image files stay in Google Drive.
- Access is governed by Google file permissions and the per-file OAuth scope.
- localStorage contains the selected spreadsheet ID, interface preferences, and—when explicitly enabled—the short-lived access token plus its expiration timestamp.
- The token is removed at least 60 seconds before expiration and after any authorization rejection, disconnect, revocation, or account switch. The browser-only flow does not store or receive a refresh token.
- No third-party analytics, advertising scripts, error trackers, or remote fonts are included in V1.
- Sheet values are rendered through safe text/value APIs, never HTML parsing APIs. Stored values such as `<img onerror=...>` and `<script>` must remain visible, inert text.
- External URL fields accept only validated HTTPS URLs.
- A restrictive Content Security Policy allows application scripts only from the same origin and required official Google origins, without inline scripts or `unsafe-eval`.
- Public external images can disclose the viewer's IP address to the image host; the privacy page and URL-entry UI must disclose this.
- The production site must publish an English privacy page describing OAuth use, local storage, Drive/Sheets storage, public image requests, and revocation.

### 8.9 Installability and caching

- The manifest uses `name: "stuff — home inventory"`, `short_name: "stuff"`, `display: "standalone"`, and `start_url: "/#/search"`.
- The app provides 192- and 512-pixel regular/maskable icons and an Apple touch icon.
- Service-worker cache names contain the application version.
- The precache contains only same-origin static shell assets.
- Navigation is network-first with a cached shell fallback; hashed routes avoid GitHub Pages rewrite requirements.
- Google API and Drive/Sheets requests are excluded from service-worker handling.
- A waiting worker triggers an in-app update prompt. Activation is user-controlled so an in-progress upload or form is not interrupted.

### 8.10 Scalability and performance

- V1 optimizes for up to 2,000 items, a few hundred places, and approximately 10,000 photo relationship rows.
- Full item/place metadata and the search index may reside in memory at this scale.
- Thumbnails use lazy loading and are requested only near the viewport.
- Blob URL and decoded image caches must be bounded and revoked on eviction.
- Sheets reads use narrow ranges and batch endpoints; writes update only known cells in the target row.
- Search uses normalized tokens plus lightweight prefix, substring, and bounded edit-distance scoring without a runtime dependency.
- Above approximately 10,000 items, pagination, selective Sheet reads, or a different database backend must be evaluated before promising equivalent performance.

### 8.11 Potential challenges

- Browser access tokens expire and cannot be refreshed silently without a backend; reconnection must be fast and non-destructive.
- Persisting a bearer token increases the impact of any same-origin XSS until token expiration; the implementation must maintain the safe-DOM, CSP, and runtime-dependency restrictions as security invariants.
- Google Picker and OAuth branding require correct Cloud configuration and production verification.
- The per-file scope can access only app-created or explicitly selected files, so manually uploaded private Drive links need Picker.
- Sheet writes are not database transactions, and manual edits bypass application version fields.
- Public image hosts may block hotlinking or remove content.
- Large camera images and long upload queues can exhaust mobile memory unless processing is sequential.
- iOS installation does not expose the standard install prompt and requires guided instructions.
- A stale service worker can run older code; `minimum_app_version` is required to protect newer schemas.
- Manual changes to required headers or tabs cannot be resolved safely by guessing.

### 8.12 GitHub Pages and domain setup

1. Create or connect the GitHub repository that will publish stuff.
2. Configure GitHub Pages to deploy the repository root from the selected production branch without a build action.
3. Commit a `CNAME` file containing `stuff.piszek.com`.
4. Add a DNS CNAME record for `stuff.piszek.com` pointing to the GitHub Pages hostname for the owning account.
5. Configure `stuff.piszek.com` as the Pages custom domain and enforce HTTPS after certificate issuance.
6. Add the final HTTPS origin to the production OAuth client and API-key referrer restrictions.
7. Verify `index.html`, `privacy.html`, the manifest, service worker scope, deep hash routes, and installation from the production origin.

## 9. User stories

### 9.1 Connect a Google account

- ID: US-001
- Description: As a user, I want to authorize my Google account so that the app can access only the inventory files I choose.
- Acceptance criteria:
  - Authorization starts only after a user action.
  - The requested data scope is `drive.file`.
  - The connection screen explains `Remember access on this device`, which defaults to enabled and can be disabled.
  - When enabled, only the token and expiration timestamp are persisted in the dedicated localStorage keys; when disabled, the token remains in memory only.
  - Canceling or denying authorization leaves the app on a usable connection screen with a retry action.

### 9.2 Create a new inventory

- ID: US-002
- Description: As an inventory owner, I want the app to create the required folders and Sheet so that I do not have to build the database manually.
- Acceptance criteria:
  - The primary action creates a dedicated root `stuff` folder directly in My Drive without opening Picker.
  - `Choose location…` opens a folder Picker and creates the dedicated root inside the selected parent.
  - An existing arbitrary folder is never adopted as the stuff root.
  - Media folders and the `stuff — Inventory` spreadsheet are created inside the dedicated root.
  - The Sheet contains valid V1 `Items`, `Places`, `Photos`, and `Settings` tabs.
  - Native dropdowns and numeric validation are installed on the declared human-editable columns.
  - The created database passes schema inspection before the app enables writes.
  - The spreadsheet ID is remembered locally.
  - The completion screen offers `Open in Google Drive` and states that moving or renaming the root later is supported.

### 9.3 Choose an existing inventory

- ID: US-003
- Description: As a returning or collaborating user, I want to choose an existing stuff Sheet so that I can use the shared inventory.
- Acceptance criteria:
  - Google Picker shows spreadsheet files.
  - The selected Sheet is inspected before use.
  - Unknown Sheets are not modified.
  - A valid selection is remembered on the device.

### 9.4 Share the inventory

- ID: US-004
- Description: As the owner, I want to share the root folder with another account so that both household members can edit the same data.
- Acceptance criteria:
  - The owner can enter a recipient email and grant editor access.
  - Sharing applies to the Sheet and media descendants.
  - Sharing errors clearly identify account policy or permission failures.
  - The app never creates a public inventory permission.

### 9.5 Reconnect after token expiration

- ID: US-005
- Description: As a returning user, I want to reconnect quickly without losing my work when the short-lived Google token expires.
- Acceptance criteria:
  - The app detects expiration and requests a new token from a user gesture.
  - In-progress text fields and selected in-memory files remain intact.
  - The previously selected spreadsheet does not need to be chosen again.
  - An unexpired remembered access token is reused after reload or reopening the PWA.
  - An expired or rejected token is deleted before reconnection; no refresh token is stored or available.

### 9.6 Search for an item

- ID: US-006
- Description: As a household member, I want to search by what I remember so that I can locate an object quickly.
- Acceptance criteria:
  - Search covers names, descriptions, tags, and complete location ancestry.
  - Case, accents, and repeated whitespace do not affect matching.
  - Exact and prefix name matches rank ahead of description matches.
  - Results update locally without a Google API request for every keystroke.

### 9.7 Browse visual and compact results

- ID: US-007
- Description: As a user, I want both a visual board and compact list so that I can recognize objects or scan details efficiently.
- Acceptance criteria:
  - The default view is a responsive masonry grid.
  - A list toggle is available and remembered as a preference.
  - Both views expose the same results and location.
  - Keyboard and screen-reader order remains logical in the masonry view.

### 9.8 Filter by location and photos

- ID: US-008
- Description: As a user, I want to narrow results to a place subtree or whether items have photos so that broad searches stay manageable.
- Acceptance criteria:
  - Selecting a place includes all descendants.
  - With-photo and without-photo filters can be combined with a selected place subtree.
  - Active filters are visible and individually removable.
  - Clearing filters restores the unfiltered search.

### 9.9 Add a text-only item

- ID: US-009
- Description: As a user in a hurry, I want to save an item with only a name so that detailed data entry is optional.
- Acceptance criteria:
  - `Name` is the only required field.
  - The app generates ID, timestamps, quantity, and version defaults.
  - The item appears in search immediately after a successful write.
  - A missing location is displayed as `Unassigned` rather than treated as an error.

### 9.10 Add an item with photos

- ID: US-010
- Description: As a mobile user, I want to photograph an item while adding it so that I can recognize it later.
- Acceptance criteria:
  - Camera and gallery actions are available on supported mobile browsers.
  - The item row is persisted before media uploads begin.
  - Photos process sequentially with visible progress.
  - Each successful photo appears in the gallery even if a later upload fails.

### 9.11 Edit and move an item

- ID: US-011
- Description: As a user, I want to maintain an item's details and location over time.
- Acceptance criteria:
  - Every human-editable field can be updated.
  - Moving updates the visible canonical location and Place ID.
  - A conflicting concurrent edit is not silently overwritten.

### 9.12 Create a place or container

- ID: US-012
- Description: As an organizer, I want to model rooms, furniture, and containers so that locations match the physical home.
- Acceptance criteria:
  - A place can be created at the root or under one parent.
  - No place type is requested or stored in V1.
  - The app generates a stable ID and full path.
  - Duplicate sibling names trigger a warning or disambiguation.

### 9.13 Move a container subtree

- ID: US-013
- Description: As an organizer, I want to move a whole container so that all contained items inherit its new effective location.
- Acceptance criteria:
  - The app prevents selecting the place or its descendants as the new parent.
  - Descendant place paths and affected item location displays are updated together.
  - Stable entity and photo relationships remain unchanged.
  - A partial failure does not leave an undetected mixed hierarchy.

### 9.14 Add photos to a place

- ID: US-014
- Description: As a user, I want to photograph a container or location so that I can identify it visually.
- Acceptance criteria:
  - Place details offer the same private photo sources as item details.
  - Photo rows use `Entity Type=Place` and the correct Entity ID.
  - The cover image appears on place cards and in the tree where appropriate.
  - Photo ordering works independently for each place.

### 9.15 Select an existing private Drive image

- ID: US-015
- Description: As a user, I want to select a private image already in Drive without making it public.
- Acceptance criteria:
  - The action opens Google Picker.
  - Selecting the file grants temporary per-file access needed to import it.
  - The app creates an app-owned full-image copy and thumbnail in the shared stuff media folders.
  - Canceling does not create a photo row.
  - The original selected image remains unchanged; the imported copy preserves the original file content and EXIF metadata and inherits the inventory folder permissions.

### 9.16 Add a public image URL

- ID: US-016
- Description: As a user, I want to reference a publicly hosted image so that it can appear without being uploaded again.
- Acceptance criteria:
  - Only HTTPS URLs are accepted.
  - A successful preview is required before saving.
  - The URL is stored with `Source=URL` and is not copied to Drive.
  - A later loading failure shows a repairable placeholder.

### 9.17 Add a public Google Drive URL

- ID: US-017
- Description: As a user, I want a truly public Drive image link to work as a URL source.
- Acceptance criteria:
  - The app extracts the file ID and optional resource key.
  - Anonymous media access is tested without the user's OAuth token.
  - A non-public file is rejected and offered through Picker.
  - Drive URLs are represented as links rather than unsupported `IMAGE()` formulas in the Sheet.

### 9.18 Reorder and remove photos

- ID: US-018
- Description: As a user, I want to choose a cover and remove mistakes so that galleries remain useful.
- Acceptance criteria:
  - Dragging or explicit order controls update the `Order` values.
  - The lowest order becomes the cover.
  - The normal remove action deletes the relationship row and leaves Drive files intact.
  - A separate confirmed delete action moves app-owned files to trash only when the current user has the required capability.
  - Canceling leaves the gallery unchanged.

### 9.19 Add an item directly in Sheets

- ID: US-019
- Description: As a direct Sheet editor, I want to add a row using ordinary fields so that bulk or desktop entry stays convenient.
- Acceptance criteria:
  - A row containing only `Name` loads as an item.
  - The app backfills ID, timestamps, version, quantity, and derived fields.
  - `Location` offers a native dropdown sourced from `Places.Path`, while a manually typed unmatched value remains visible for diagnostics.
  - Existing human values are not overwritten.
  - The user is never required to fill an invisible column.

### 9.20 Add or edit a place directly in Sheets

- ID: US-020
- Description: As a direct Sheet editor, I want to maintain places using readable names and paths.
- Acceptance criteria:
  - A row containing only `Name` becomes a valid root place.
  - `Parent` offers a native dropdown sourced from `Places.Path`, and blank remains valid for a root place.
  - A unique `Parent` name/path resolves to Parent ID and canonical Path.
  - Ambiguous or cyclic relationships are marked for correction.
  - Sorting rows does not change the tree.

### 9.21 Add a public photo relationship in Sheets

- ID: US-021
- Description: As a direct Sheet editor, I want to paste a public URL and readable entity name so that URL photos do not require the app form.
- Acceptance criteria:
  - Entity Type, Entity, Source, and URL are sufficient input.
  - `Entity Type` and `Source` use native Sheet dropdowns.
  - The app validates the URL and resolves an unambiguous entity.
  - Generated photo and entity IDs are backfilled.
  - Ambiguous or invalid rows remain visible with diagnostics and are not guessed.

### 9.22 Repair safe schema drift

- ID: US-022
- Description: As an owner, I want the app to repair missing generated structure without damaging manual data.
- Acceptance criteria:
  - Inspection lists every proposed change before repair.
  - Reordered and unknown columns are preserved.
  - Missing generated columns, validation, and formatting can be recreated.
  - Missing or renamed required human headers do not trigger guessed writes.

### 9.23 Migrate an older schema

- ID: US-023
- Description: As an owner, I want older supported Sheets upgraded safely so that the app can evolve.
- Acceptance criteria:
  - The app displays source version, target version, and migration summary.
  - A successful Drive backup is required before mutation.
  - Progress is persisted after each idempotent migration step.
  - Success updates the schema version only after target validation.
  - Failure disables writes and exposes retry and backup actions.

### 9.24 Recover an interrupted migration

- ID: US-024
- Description: As an owner, I want to resume or recover from an interrupted migration so that a closed tab or network failure does not strand the database.
- Acceptance criteria:
  - Connection detects a non-idle migration state.
  - Completed steps are not applied destructively twice.
  - The user can retry from the recorded step or open the backup.
  - Normal writes remain disabled until inspection passes.

### 9.25 Protect a newer schema from an old app

- ID: US-025
- Description: As an owner, I want stale cached application code blocked from editing a newer Sheet.
- Acceptance criteria:
  - The app compares schema and minimum application versions before enabling writes.
  - An incompatible app opens the data read-only where safe.
  - The user receives a clear update/reload action.
  - No write request is sent before compatibility is established.

### 9.26 Resolve an edit conflict

- ID: US-026
- Description: As an editor, I want to know when another user or the Sheet changed my record so that I do not lose their work.
- Acceptance criteria:
  - The app refetches the current row by ID before update.
  - Changed human fields are shown beside proposed values.
  - Reload and explicit overwrite are available.
  - Dismissing the dialog sends no write.

### 9.27 Diagnose inconsistent data

- ID: US-027
- Description: As an owner, I want diagnostics for broken relationships and identifiers so that manual edits remain recoverable.
- Acceptance criteria:
  - Diagnostics detect missing/duplicate IDs, unresolved place references, missing entities for photos, and unreferenced app-owned media.
  - Every issue identifies the tab and readable record.
  - Safe fixes can be previewed; ambiguous fixes require a choice.
  - Running diagnostics alone does not mutate data.

### 9.28 Install stuff on a home screen

- ID: US-028
- Description: As a frequent mobile user, I want to install stuff so that it launches like a dedicated utility.
- Acceptance criteria:
  - Installable browsers receive an install action.
  - iOS receives accurate manual instructions.
  - The installed app launches in standalone mode at the search route.
  - Icons display correctly in regular and maskable contexts.

### 9.29 Update the installed application

- ID: US-029
- Description: As a user, I want controlled application updates so that new code does not interrupt an upload or edit.
- Acceptance criteria:
  - A waiting service worker triggers an update notice.
  - Reload occurs only after user confirmation.
  - Active forms and uploads warn before reload.
  - Old caches are removed after the new worker activates.

### 9.30 Use the offline shell

- ID: US-030
- Description: As a user without a network connection, I want a clear offline state rather than a broken page.
- Acceptance criteria:
  - The static shell opens from cache after a prior successful visit.
  - The app states that Google connection is required for inventory data.
  - No offline write is presented as successfully synchronized.
  - Reconnection reloads current data from the Sheet.

### 9.31 Disconnect or revoke access

- ID: US-031
- Description: As a user, I want to clear the local inventory connection or revoke Google consent so that I control access from the device.
- Acceptance criteria:
  - `Disconnect inventory` clears the stored spreadsheet ID, both dedicated token keys, and in-memory data but does not delete Drive files.
  - `Revoke Google access` requires confirmation and uses the Google revocation flow.
  - Neither action deletes the Sheet, folders, or photos.
  - The app returns to the connection screen.

### 9.32 Use the application accessibly

- ID: US-032
- Description: As a keyboard, touch, or assistive-technology user, I want the full inventory workflow to remain operable.
- Acceptance criteria:
  - Search, add, edit, place navigation, dialogs, uploads, migration, and settings are keyboard operable.
  - Focus is visible and correctly restored after dialogs.
  - Labels, status announcements, errors, and upload progress are exposed to assistive technology.
  - Touch targets and color contrast meet the stated accessibility requirements.

### 9.33 Remember or forget temporary Google access

- ID: US-033
- Description: As a user, I want to choose whether this device remembers my temporary Google access token so that I can balance convenience and security.
- Acceptance criteria:
  - `Remember access on this device` is shown with a concise risk explanation during connection and in Settings.
  - With the option enabled, reopening the app reuses a valid token without another Google interaction.
  - With the option disabled, the token is held only in memory and any persisted token is removed immediately.
  - Expired tokens are removed at least 60 seconds before expiration and are never used for an API request.
  - Disconnecting, revoking, or switching account removes both dedicated token keys.
