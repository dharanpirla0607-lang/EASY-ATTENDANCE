# Amrita Attendance Visualizer

A browser extension for Amrita Vishwa Vidyapeetham students that links directly to the My Amrita attendance page, reads the attendance table, and visualizes each course with a clean pink-and-white dashboard.

## Features

- Current attendance percentage for every subject
- Large attendance bars with a 75% target marker
- Safe leave-day count for every class while staying at 75%
- Recovery count when a subject is below 75%
- Draggable floating dashboard on the attendance page
- Small, medium, and large widget size controls
- Timetable upload for PDF, JPG, PNG, or screenshots
- Weekly timetable builder for accurate leave planning
- Date-range leave planner with From and To dates
- Automatic leave impact based on scheduled weekday classes
- Projected attendance loss after taking leave

## Load In Chrome Or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder:

   `C:\Users\DHARANENDHRAN\OneDrive\Documents\kothhaga`

5. Open the attendance page:

   `https://students.amrita.edu/client/class-attendance`

## Timetable Upload

Use the popup to upload your timetable PDF or image. The extension stores it locally and shows a preview in the popup. Use it as a reference while adding your weekly classes below it.

The extension does not send your timetable anywhere. The uploaded file stays in browser storage for this extension.

## Leave Planner

First add weekly classes by choosing weekday, subject, and class count. Then select a leave range using From and To dates. The planner expands that range into individual dates and uses your weekly timetable to count only the subjects scheduled on those days.

If a selected date has no timetable entry, the planner falls back to enabled subject toggles so you can still estimate leave impact.

The planner shows:

- Your current percentage
- Your projected percentage after leave
- How much attendance you lose
- Whether you remain above 75%
- How many extra classes are needed if the plan drops you below 75%

## Files

- `manifest.json` registers the extension, popup, permissions, and Amrita attendance-page content script.
- `content.js` reads the attendance table, calculates results, stores them, and injects the floating widget.
- `popup.html` and `popup.js` show the toolbar popup dashboard, timetable upload, and leave planner.
- `styles.css` styles both the popup and the injected page widget.

## Notes

The parser supports common table headings such as course code, course name, total classes, present, duty leave, absent, medical leave, and attendance percentage. If Amrita changes the portal table labels, update `HEADER_ALIASES` in `content.js`.