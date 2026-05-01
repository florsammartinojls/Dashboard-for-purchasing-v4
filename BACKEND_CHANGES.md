# Apps Script changes for Item 8 (Segment overrides → shared sheet)

The front-end is ready (PR `Item 8` in this repo). It looks for
`data.segmentOverrides` in the live snapshot and writes via
`apiPost({ action: 'saveSegmentOverride' | 'deleteSegmentOverride', ... })`.

Until you apply the changes below, the override system **falls back
to localStorage** (the v1 behavior), so nothing breaks. Once you apply
them, the front-end picks up shared overrides automatically on the
next live refresh, and a one-time migration prompt offers to push any
existing local overrides to the backend.

All changes go in `Code.gs` of the JLS workflow Apps Script project.

---

## 1. Create the sheet

In the workflow spreadsheet (`CONFIG.sheets.workflow`) create a new
sheet named **`Segment Overrides`** with this header row:

| bundleId | segment | updatedBy | updatedAt | reason |

Freeze the header row.

---

## 2. Reader

Add a new function alongside the other `process*` helpers:

```js
function processSegmentOverrides() {
  const ss = SpreadsheetApp.openById(CONFIG.sheets.workflow);
  const sh = ss.getSheetByName('Segment Overrides');
  if (!sh) return [];
  const rng = sh.getDataRange().getValues();
  if (rng.length < 2) return [];
  const headers = rng[0].map(h => String(h || '').trim());
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });
  const out = [];
  for (let r = 1; r < rng.length; r++) {
    const row = rng[r];
    const bundleId = String(row[idx.bundleId] || '').trim();
    const segment  = String(row[idx.segment]  || '').trim();
    if (!bundleId || !segment) continue;
    out.push({
      bundleId,
      segment,
      updatedBy: String(row[idx.updatedBy] || ''),
      updatedAt: row[idx.updatedAt] instanceof Date
        ? row[idx.updatedAt].toISOString()
        : String(row[idx.updatedAt] || ''),
      reason:    String(row[idx.reason] || ''),
    });
  }
  return out;
}
```

---

## 3. Wire into the live snapshot

In `buildAndWriteLive` (or wherever the live snapshot is assembled),
add:

```js
safeRunInto(snapshot, 'segmentOverrides', processSegmentOverrides);
```

It should sit next to the existing `safeRunInto(..., 'workflow', processWorkflow);` line.

---

## 4. Write endpoints

In `doPost`, add cases:

```js
case 'saveSegmentOverride':   r = saveSegmentOverride(body);   break;
case 'deleteSegmentOverride': r = deleteSegmentOverride(body); break;
```

Then implement them:

```js
function saveSegmentOverride(body) {
  const bundleId = String(body.bundleId || '').trim();
  const segment  = String(body.segment  || '').trim();
  if (!bundleId || !segment) {
    return { status: 'error', message: 'bundleId and segment required' };
  }
  const ss = SpreadsheetApp.openById(CONFIG.sheets.workflow);
  const sh = ss.getSheetByName('Segment Overrides');
  if (!sh) {
    return { status: 'error', message: 'Segment Overrides sheet not found' };
  }
  const updatedBy = String(body.updatedBy || '');
  const reason    = String(body.reason    || '');
  const updatedAt = new Date().toISOString();

  // Find existing row by bundleId
  const rng = sh.getDataRange().getValues();
  const headers = rng[0];
  const colId = headers.indexOf('bundleId');
  const colSeg = headers.indexOf('segment');
  const colBy = headers.indexOf('updatedBy');
  const colAt = headers.indexOf('updatedAt');
  const colWhy = headers.indexOf('reason');
  if (colId < 0 || colSeg < 0) {
    return { status: 'error', message: 'Sheet missing bundleId/segment columns' };
  }
  for (let r = 1; r < rng.length; r++) {
    if (String(rng[r][colId] || '').trim() === bundleId) {
      sh.getRange(r + 1, colSeg + 1).setValue(segment);
      if (colBy  >= 0) sh.getRange(r + 1, colBy  + 1).setValue(updatedBy);
      if (colAt  >= 0) sh.getRange(r + 1, colAt  + 1).setValue(updatedAt);
      if (colWhy >= 0) sh.getRange(r + 1, colWhy + 1).setValue(reason);
      return { status: 'ok', bundleId, action: 'updated' };
    }
  }
  // Append a fresh row
  sh.appendRow([bundleId, segment, updatedBy, updatedAt, reason]);
  return { status: 'ok', bundleId, action: 'inserted' };
}

function deleteSegmentOverride(body) {
  const bundleId = String(body.bundleId || '').trim();
  if (!bundleId) {
    return { status: 'error', message: 'bundleId required' };
  }
  const ss = SpreadsheetApp.openById(CONFIG.sheets.workflow);
  const sh = ss.getSheetByName('Segment Overrides');
  if (!sh) return { status: 'ok', bundleId, action: 'noop' };
  const rng = sh.getDataRange().getValues();
  const headers = rng[0];
  const colId = headers.indexOf('bundleId');
  if (colId < 0) return { status: 'error', message: 'bundleId column missing' };
  for (let r = rng.length - 1; r >= 1; r--) {
    if (String(rng[r][colId] || '').trim() === bundleId) {
      sh.deleteRow(r + 1);
      return { status: 'ok', bundleId, action: 'deleted' };
    }
  }
  return { status: 'ok', bundleId, action: 'not-found' };
}
```

---

## 5. Verify

1. Set an override from one buyer's browser → row appears in `Segment Overrides`.
2. Reload from another buyer's browser → see the override + "by [name]" text under the dropdown.
3. Reset to auto → row disappears from the sheet.
4. The migration prompt fires once for any buyer with pre-existing local overrides; after they accept, those overrides land in the sheet.

If the front-end ever stops seeing remote rows, it falls back to
localStorage automatically — no breaking failure.
