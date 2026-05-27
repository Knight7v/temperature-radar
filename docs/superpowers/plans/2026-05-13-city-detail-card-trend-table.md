# City Detail Card Trend Table Visual Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the visual design of the "Future 7-day ADI Trend" table in the city detail card with a minimalist, compact style that aligns with the detail grid.

**Architecture:** CSS-only modification - update existing forecast table styles to use 5 equal-width columns, reduced padding (8px), and simplified borders for better visual alignment with the detail grid.

**Tech Stack:** Vanilla CSS, CSS Grid

---

## File Structure

**Modified files:**
- `css/styles-v2.css` - Contains all forecast table styles to be updated

**No new files created** - This is a pure CSS optimization of existing styles.

---

## Task 1: Update Forecast Table Container Styles

**Files:**
- Modify: `css/styles-v2.css:1126`

- [ ] **Step 1: Locate current .forecast-table styles**

Current CSS at line 1126:
```css
.forecast-table { width: 100%; border: none; border-radius: 0; overflow: visible; box-sizing: border-box; background: var(--bg-secondary); border-radius: 8px; }
```

- [ ] **Step 2: Replace with optimized container styles**

Replace line 1126 with:
```css
.forecast-table {
    width: 100%;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    overflow: hidden;
    box-sizing: border-box;
    background: transparent;
}
```

Changes:
- Restore `border: 1px solid var(--border-color)` for visual alignment with detail grid cards
- Remove duplicate `border-radius: 0`, keep only `border-radius: 8px`
- Change `overflow: visible` to `overflow: hidden` to ensure border-radius works
- Change `background` from `var(--bg-secondary)` to `transparent` for cleaner look

- [ ] **Step 3: Verify the changes**

Check that:
- Border matches detail grid card border style
- Border-radius is 8px (same as detail grid cards)
- Box-sizing includes border in width calculation
- No duplicate or conflicting properties

- [ ] **Step 4: Commit**

```bash
git add css/styles-v2.css
git commit -m "style: update forecast table container for minimalist compact design"
```

---

## Task 2: Update Forecast Header Styles - Equal Width Columns

**Files:**
- Modify: `css/styles-v2.css:1127-1131`

- [ ] **Step 1: Locate current .forecast-header styles**

Current CSS at lines 1127-1131:
```css
.forecast-header {
    display: grid; grid-template-columns: 0.8fr 0.45fr 0.45fr 0.45fr 0.6fr; gap: var(--spacing-sm);
    padding: var(--spacing-md); background: var(--bg-secondary);
    font-size: 0.7rem; color: var(--text-secondary); font-weight: 500; box-sizing: border-box; border-radius: 8px 8px 0 0;
}
```

- [ ] **Step 2: Replace with equal-width columns and compact padding**

Replace lines 1127-1131 with:
```css
.forecast-header {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
    gap: var(--spacing-sm);
    padding: 8px;
    background: var(--bg-secondary);
    font-size: 0.7rem;
    color: var(--text-secondary);
    font-weight: 500;
    box-sizing: border-box;
    border-bottom: 1px solid var(--border-color);
}
```

Changes:
- Change `grid-template-columns` from `0.8fr 0.45fr 0.45fr 0.45fr 0.6fr` to `1fr 1fr 1fr 1fr 1fr` (5 equal columns)
- Change `padding` from `var(--spacing-md)` (16px) to `8px` (compact, 50% reduction)
- Remove `border-radius: 8px 8px 0 0` (no longer needed with new design)
- Add `border-bottom: 1px solid var(--border-color)` to separate from data rows

- [ ] **Step 3: Verify the changes**

Check that:
- All 5 columns have equal width (1fr each)
- Padding is exactly 8px
- Border-bottom provides separation from data rows
- No conflicting border-radius

- [ ] **Step 4: Commit**

```bash
git add css/styles-v2.css
git commit -m "style: update forecast header with equal columns and compact padding"
```

---

## Task 3: Update Forecast Row Styles - Equal Width Columns

**Files:**
- Modify: `css/styles-v2.css:1132-1135`

- [ ] **Step 1: Locate current .forecast-row styles**

Current CSS at lines 1132-1135:
```css
.forecast-row {
    display: grid; grid-template-columns: 0.8fr 0.45fr 0.45fr 0.45fr 0.6fr; gap: var(--spacing-sm);
    padding: var(--spacing-md); font-size: 0.75rem; border-top: 1px solid var(--border-color); box-sizing: border-box;
}
```

- [ ] **Step 2: Replace with equal-width columns and compact padding**

Replace lines 1132-1135 with:
```css
.forecast-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
    gap: var(--spacing-sm);
    padding: 8px;
    font-size: 0.75rem;
    border-top: 1px solid var(--border-color);
    box-sizing: border-box;
}
```

Changes:
- Change `grid-template-columns` from `0.8fr 0.45fr 0.45fr 0.45fr 0.6fr` to `1fr 1fr 1fr 1fr 1fr` (5 equal columns)
- Change `padding` from `var(--spacing-md)` (16px) to `8px` (compact, 50% reduction)
- Keep all other properties the same

- [ ] **Step 3: Verify the changes**

Check that:
- Column layout matches header (5 equal columns)
- Padding matches header (8px)
- Border-top provides row separation
- Font-size remains 0.75rem for data

- [ ] **Step 4: Commit**

```bash
git add css/styles-v2.css
git commit -m "style: update forecast row with equal columns and compact padding"
```

---

## Task 4: Clean Up Duplicate Styles

**Files:**
- Modify: `css/styles-v2.css:1136-1139`

- [ ] **Step 1: Locate and remove duplicate .forecast-row.hot rule**

Current CSS has duplicate at lines 1137-1138:
```css
.forecast-row.hot { background: rgba(255, 0, 0, 0.05); }
.forecast-row.hot { background: rgba(255, 0, 0, 0.05); }
```

- [ ] **Step 2: Remove duplicate, keep single rule**

Replace lines 1137-1138 with:
```css
.forecast-row.hot { background: rgba(255, 0, 0, 0.05); }
.forecast-row:last-child { border-radius: 0 0 8px 8px; }
```

Actually, the `:last-child` rule is no longer needed with the new design. Replace with just:
```css
.forecast-row.hot { background: rgba(255, 0, 0, 0.05); }
```

- [ ] **Step 3: Verify no other duplicates**

Check lines 1136-1139:
```css
.forecast-row:last-child { border-radius: 0 0 8px 8px; }
.forecast-row.hot { background: rgba(255, 0, 0, 0.05); }
.forecast-date { display: flex; align-items: center; gap: var(--spacing-xs); }
```

Remove the `:last-child` rule as it's not needed - keep only:
```css
.forecast-row.hot { background: rgba(255, 0, 0, 0.05); }
.forecast-date { display: flex; align-items: center; gap: var(--spacing-xs); }
```

- [ ] **Step 4: Commit**

```bash
git add css/styles-v2.css
git commit -m "style: remove duplicate forecast-row.hot rule and unused last-child style"
```

---

## Task 5: Visual Testing and Verification

**Files:**
- No file changes - testing only

- [ ] **Step 1: Open the application and navigate to city detail**

1. Open `index-v2.html` in a browser
2. Click on any city on the map to open the city detail modal
3. Scroll to the "未来7天ADI趋势" section

- [ ] **Step 2: Verify table alignment with detail grid**

Expected:
- Table width matches detail grid width exactly
- Left and right edges align perfectly
- No overflow or horizontal scrolling

- [ ] **Step 3: Verify column widths are equal**

Expected:
- All 5 columns have the same width
- Date, 最高温, 夜间, 体感, ADI columns are visually equal
- Data fits comfortably in each column

- [ ] **Step 4: Verify compact padding**

Expected:
- Row padding is 8px (visually tighter than before)
- Information density increased by ~50%
- Still readable and not cramped

- [ ] **Step 5: Verify hot night highlighting**

Expected:
- Rows with hot night (🌙 icon) have light red background
- Background color is `rgba(255, 0, 0, 0.05)`
- Text remains readable with the background

- [ ] **Step 6: Verify border consistency**

Expected:
- Table outer border matches detail grid card borders
- Row separator borders are visible but not heavy
- Overall visual harmony with detail grid

- [ ] **Step 7: Test responsiveness**

Expected:
- At 650px modal width, all content fits
- No horizontal scroll
- No text overflow or wrapping issues

- [ ] **Step 8: Test multiple cities**

Test with at least 3 different cities:
- One with hot nights
- One without hot nights
- One with extreme temperatures

Expected: All render correctly with consistent styling

---

## Task 6: Final Code Review

**Files:**
- Review: `css/styles-v2.css:1125-1139`

- [ ] **Step 1: Review the complete forecast section CSS**

Read lines 1125-1139 and verify:

```css
.forecast-section h3 { margin-bottom: var(--spacing-md); font-size: 0.9rem; }
.forecast-table {
    width: 100%;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    overflow: hidden;
    box-sizing: border-box;
    background: transparent;
}
.forecast-header {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
    gap: var(--spacing-sm);
    padding: 8px;
    background: var(--bg-secondary);
    font-size: 0.7rem;
    color: var(--text-secondary);
    font-weight: 500;
    box-sizing: border-box;
    border-bottom: 1px solid var(--border-color);
}
.forecast-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
    gap: var(--spacing-sm);
    padding: 8px;
    font-size: 0.75rem;
    border-top: 1px solid var(--border-color);
    box-sizing: border-box;
}
.forecast-row.hot { background: rgba(255, 0, 0, 0.05); }
.forecast-date { display: flex; align-items: center; gap: var(--spacing-xs); }
```

- [ ] **Step 2: Verify spec compliance**

Check against design spec:
- ✓ 5 equal-width columns (1fr each)
- ✓ 8px padding (not var(--spacing-md))
- ✓ Border: 1px solid var(--border-color)
- ✓ Border-radius: 8px
- ✓ Box-sizing: border-box
- ✓ Background: transparent
- ✓ Hot night row: rgba(255, 0, 0, 0.05)

- [ ] **Step 3: Check for CSS issues**

Verify:
- No duplicate properties
- No conflicting rules
- No missing semicolons
- Consistent formatting
- No unused selectors

- [ ] **Step 4: Final commit if any cleanup needed**

If any minor adjustments were made during review:

```bash
git add css/styles-v2.css
git commit -m "style: final cleanup for forecast table redesign"
```

---

## Success Criteria

After completion, the following should be true:

1. ✓ Table width is 100% and aligns with detail grid
2. ✓ All 5 columns have equal width (1fr each)
3. ✓ Padding is 8px (compact, 50% reduction from 16px)
4. ✓ Border style matches detail grid cards
5. ✓ Hot night highlighting still works
6. ✓ No visual regression in other parts of the application
7. ✓ No duplicate or conflicting CSS rules
8. ✓ Code is clean and maintainable

---

## Testing Checklist

- [ ] Visual alignment test - table vs detail grid
- [ ] Column width test - all 5 columns equal
- [ ] Padding test - 8px compact spacing
- [ ] Hot night test - background highlighting works
- [ ] Border test - consistent with detail grid
- [ ] Responsiveness test - no overflow at 650px
- [ ] Cross-city test - multiple cities render correctly
- [ ] Code review test - no duplicates, clean CSS

---

## Notes

- This is a CSS-only change - no HTML or JavaScript modifications needed
- The forecast table is rendered dynamically by `renderForecastTable()` in `js/ui.js` - no changes needed there
- All changes are backward compatible - data structure remains the same
- Changes only affect visual presentation, not functionality
