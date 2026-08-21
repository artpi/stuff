---
name: stuff-inventory
description: Read and operate a stuff home inventory directly through its Google Sheet and Drive folder when the user provides access, without using the stuff website.
---

# Operate a stuff inventory

Use this skill when a user wants to find, add, update, move, or organize possessions in a `stuff` inventory and you can access their Google Sheets or Google Drive. The Google Sheet is the source of truth; the website is only one client for it.

Production documentation: <https://stuff.piszek.com/SKILL.md>

## Authorization and discovery

- Treat the user's request as authority only for the requested reads or changes. Ask before destructive or broad changes, including row deletion, file deletion, bulk rewrites, or changing the place hierarchy.
- Never request, expose, or store the website's OAuth token. Use the Google Sheets/Drive connection available to your agent.
- Prefer a spreadsheet URL or ID supplied by the user. Otherwise search accessible Drive files for a Google Sheet named `stuff — Inventory`.
- If multiple candidates exist, identify them by owner, parent folder, and modification time and ask which inventory to use.
- Before writing, verify all four tabs exist: `Items`, `Places`, `Photos`, and `Settings`.
- Before any spreadsheet write, show the user the intended records and fields, then obtain explicit confirmation. A request to inspect, diagnose, search, or propose changes does not authorize editing the Sheet.
- Read `Settings!A:C` and continue only when `database_type` is exactly `stuff`, `schema_version` is `1`, and `migration_state` is `idle`. If `minimum_app_version` or a newer schema suggests incompatibility, stop and direct the user to the website.
- Use header names, never fixed column letters. Columns may be reordered and unknown custom columns may exist.
- Send writes as literal/RAW cell values. Never turn inventory text into a formula, even when it begins with `=`, `+`, `-`, or `@`.

## Operating model

The workbook is designed for direct editing. Human-facing columns come first; generated columns maintain stable relationships and application metadata.

For routine additions, an agent may write only the human-facing values and leave generated cells blank. The website fills safe generated values the next time it synchronizes. For an immediately consistent database, follow the generated-field rules below.

Always preserve:

- unknown columns, tabs, formatting, and values;
- header names and the four required tab names;
- existing UUIDs and foreign-key IDs;
- ISO 8601 UTC timestamps already present;
- `Settings` values unless the user explicitly asks for schema maintenance through the website.

Before updating an existing row, compare its current human-facing values with the values you originally read and surface a conflict if they changed. After a write, reread the affected row by stable `ID` when one exists. Row numbers are not stable because users may sort or reorder the Sheet.

Do not invent tags because they seem plausible. Preserve existing tags unless the user asks to change them. For new or updated items, write only tags the user supplied or explicitly approved. You may propose a concise set of tags, but present the proposal separately and wait for confirmation before adding it to the Sheet.

## Schema v1

### Items

| Header | Kind | Meaning |
| --- | --- | --- |
| `Name` | human, required | Item name. |
| `Location` | human | Prefer the exact `Places.Path` value. |
| `Description` | human | Free text. |
| `Tags` | human | User-approved free text; the website parses comma-separated tags. |
| `Quantity` | human | Positive number; default `1`. |
| `Photo Count` | generated | Count of related `Photos` rows. |
| `Cover Photo` | generated | URL for the first ordered photo. |
| `ID` | generated, required | Stable UUID. Never reuse or change an existing one. |
| `Place ID` | generated | `Places.ID` for the location. |
| `Created At` | generated | ISO 8601 UTC creation time. |
| `Updated At` | generated | ISO 8601 UTC modification time. |
| `Version` | generated | Positive integer revision. |

### Places

Places form a tree. A place can mean a home, room, cabinet, shelf, box, or any other container.

| Header | Kind | Meaning |
| --- | --- | --- |
| `Name` | human, required | Name within its parent. |
| `Parent` | human | Prefer the exact parent `Path`; blank for a root place. |
| `Description` | human | Free text. |
| `Path` | generated | Full path joined with ` / `. |
| `Photo Count` | generated | Count of related `Photos` rows. |
| `Cover Photo` | generated | URL for the first ordered photo. |
| `ID` | generated, required | Stable UUID. |
| `Parent ID` | generated | `Places.ID` of the parent. |
| `Created At` | generated | ISO 8601 UTC creation time. |
| `Updated At` | generated | ISO 8601 UTC modification time. |
| `Version` | generated | Positive integer revision. |

### Photos

| Header | Kind | Meaning |
| --- | --- | --- |
| `Entity Type` | human | Exactly `Item` or `Place`. |
| `Entity` | human | Item name or, for a place, preferably its full path. |
| `Source` | human | Exactly `URL` or `Drive`. |
| `URL` | human | Public HTTPS image URL; required for `URL` source. |
| `Order` | human | Positive number within one entity; lowest is the cover. |
| `Description` | human | Caption or alt-text-like description. |
| `ID` | generated, required | Stable UUID. |
| `Entity ID` | generated | Matching `Items.ID` or `Places.ID`. |
| `Drive File ID` | generated | Full-size Drive image ID for `Drive` source. |
| `Thumbnail File ID` | generated | Thumbnail Drive image ID for `Drive` source. |
| `Created At` | generated | ISO 8601 UTC creation time. |

### Settings

`Settings` uses `Key`, `Value`, and `Description`. It is structural metadata, not normal inventory content. Read it for validation; do not edit it during inventory operations.

`photo_access_mode` controls new Drive photo uploads. Missing or `private` means per-user Drive API access. `anyone_with_link` means both uploaded files receive non-discoverable link-reader permission and the `URL` field stores the anonymously readable original while the row remains `Source=Drive`.

## Read workflows

Read `Items`, `Places`, and `Photos` with unformatted values. Ignore completely empty rows. Match headers case-insensitively after trimming and collapsing whitespace.

When answering where something is:

1. Search item `Name`, `Description`, `Tags`, and `Location` case- and accent-insensitively.
2. Use `Place ID` to resolve the exact place when available.
3. Walk `Parent ID` upward to explain the physical hierarchy. Fall back to `Path` only if IDs are absent.
4. If names are ambiguous, show the full location paths and ask the user to disambiguate.

When inventory totals matter, treat `Quantity` as `1` if blank or invalid. Do not infer ownership, value, or availability from presence in the Sheet.

## Safe writes

### Add an item

Resolve the requested location to exactly one place. Prefer exact `Path`, then a unique place `Name`. If it is ambiguous, ask rather than guessing.

Append a row without overwriting or shifting existing data. At minimum set `Name`; set `Location` to the resolved path and `Quantity` to a positive number or `1`.

For immediate consistency also set:

- `ID`: a new UUID v4;
- `Place ID`: the resolved place UUID, or blank when no place was provided;
- `Created At` and `Updated At`: the same current ISO 8601 UTC timestamp;
- `Version`: `1`;
- `Photo Count`: `0`;
- `Cover Photo`: blank.

### Update an item

Locate it by `ID`, reread the current row immediately before writing, and update only intended cells. If the user identified it by name and multiple rows match, ask which one.

When changing location, update both `Location` and `Place ID`. Set `Updated At` to now and increment numeric `Version` by one. Preserve `Created At`, `ID`, photo summaries, and unknown columns.

### Add a place

Resolve the parent to exactly one place, or leave it blank for a root. Reject a duplicate sibling with the same normalized name.

For immediate consistency set a new UUID v4 `ID`, the parent's exact `Path` and `ID`, the computed `Path`, timestamps, `Version` `1`, `Photo Count` `0`, and blank `Cover Photo`.

### Rename or move a place

This is a cascading operation. Before writing, build the place graph by `ID`/`Parent ID` and reject cycles, self-parenting, and moves into descendants. Then:

1. Update the target's `Name`, `Parent`, `Parent ID`, `Updated At`, and `Version`.
2. Recompute `Path` for it and every descendant.
3. Update `Items.Location` for every item whose `Place ID` is in that subtree.
4. Update `Photos.Entity` for place-photo rows whose `Entity ID` is in that subtree.
5. Preserve all IDs.

Preview the scope and get confirmation before a large cascade.

### Add a public URL photo

Confirm the URL is HTTPS and points to an image the intended viewers can access. Resolve exactly one item or place and append a `Photos` row with:

- `Entity Type`, the display `Entity`, `Source` = `URL`, `URL`, and optional `Description`;
- `Order` = one more than the current maximum for that `Entity ID`;
- a new UUID v4 `ID`, the stable `Entity ID`, and current `Created At`.

Then set the entity's `Photo Count` to its actual number of photo rows. Set `Cover Photo` from the lowest-order photo: its `URL` for a URL source, or `https://drive.google.com/open?id=DRIVE_FILE_ID` for a Drive source.

### Add a Drive photo

Use only when the agent has Drive write access to the folders identified by `photos_folder_id` and `thumbnails_folder_id` in `Settings`. Upload the original into the Photos folder and an approximately 480-pixel web-compatible thumbnail into Thumbnails, then append the relationship row with `Source` = `Drive`, both file IDs, a new photo UUID, and the resolved entity ID. Do not substitute a local path or a normal Drive sharing URL into `URL`.

When `photo_access_mode=anyone_with_link`, grant `type=anyone`, `role=reader`, and non-discoverable permission to both files, verify anonymous image loading without an OAuth token, and store the canonical `https://drive.usercontent.google.com/download?...` original URL in `URL`. If publishing or verification fails, remove only permissions created by the failed attempt, keep uploaded files for diagnostics, and do not append a misleading public relationship row.

If either upload or the row append fails, report the partial result and do not silently retry destructive cleanup. Never delete source files. Direct URL photos are safer when Drive media tooling is unavailable.

### Recover access to directly uploaded Drive photos

The website uses the restricted `drive.file` OAuth scope. An image placed directly into the inventory's Drive folders can therefore exist and be referenced correctly while still returning `404` to the website. Selecting a folder does not grant access to every file inside it.

When the website reports **Photo access needs recovery**, use its **Recover access** action. The user must select the highlighted original image in Google Picker. Recovery then:

1. grants the app durable `drive.file` access to the selected, already-referenced original while preserving its `Drive File ID`;
2. creates a new approximately 480-pixel JPEG thumbnail in `thumbnails_folder_id`;
3. updates the existing `Photos` row with the new `Thumbnail File ID` only;
4. preserves the photo relationship's `ID`, entity, order, description, and creation time.

Recovery is per photo. Every directly uploaded photo with this problem must be recovered separately through Picker; recovering one photo or selecting a folder does not authorize the others. After each recovery, verify that the original `Drive File ID` is unchanged and readable, that the `Thumbnail File ID` was replaced and resolves, and that the photo still displays after a full page reload. Do not manually substitute guessed Drive IDs or claim a batch is repaired without checking every affected row.

### Reorder or remove photos

Reordering changes only `Order`; assign consecutive positive integers and then recompute the entity's cover summary.

Removing the Sheet relationship and trashing Drive files are separate operations. Delete a `Photos` row only with user authorization. Trash its `Drive File ID` and `Thumbnail File ID` only when the user separately asks to delete the files and you have verified the IDs belong to that relationship.

## Deletion and bulk changes

- Preview affected IDs and counts before deleting items, places, photo relationships, or many rows.
- Deleting an item or place can orphan `Photos` rows. Delete or reassign those relationships in the same confirmed operation, but do not trash Drive media unless explicitly requested.
- Deleting a place can orphan child places and items. Require the user to choose whether to move, reassign, or delete each dependent group.
- For bulk edits, reread immediately before the write, update only named fields, preserve row order unless sorting was requested, and report changed and skipped rows.
- Never clear whole ranges merely to rewrite a table.

## Consistency checks after mutation

Verify the affected records and report any issue rather than guessing:

- all nonblank `ID` values are unique within their tab;
- each `Place ID`, `Parent ID`, and `Entity ID` resolves to the correct record type;
- the place graph is acyclic;
- `Location`, `Parent`, `Path`, and place-photo `Entity` agree with their ID-based relationships;
- quantities and photo orders are positive;
- photo counts and cover photos match actual photo rows;
- updated records retain unknown-column values.

If generated fields were intentionally left blank, tell the user to open stuff and choose **Settings → Sync now**. Use the website for schema repair, migrations, diagnostics involving orphaned Drive media, OAuth sharing, or any state this skill cannot validate safely.
