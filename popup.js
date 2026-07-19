(function () {
  const ATTENDANCE_URL = "https://students.amrita.edu/client/class-attendance";
  const STORAGE_KEY = "amritaAttendanceData";
  const PLANNER_KEY = "amritaAttendancePlanner";
  const TARGET_PERCENTAGE = 75;
  const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
  const DAYS = [
    { value: "1", label: "Monday" },
    { value: "2", label: "Tuesday" },
    { value: "3", label: "Wednesday" },
    { value: "4", label: "Thursday" },
    { value: "5", label: "Friday" },
    { value: "6", label: "Saturday" },
    { value: "0", label: "Sunday" }
  ];

  const courseList = document.getElementById("courseList");
  const emptyState = document.getElementById("emptyState");
  const summary = document.getElementById("summary");
  const planner = document.getElementById("planner");
  const timetable = document.getElementById("timetable");
  const timetableUpload = document.getElementById("timetableUpload");
  const averageValue = document.getElementById("averageValue");
  const courseCount = document.getElementById("courseCount");
  const safeCount = document.getElementById("safeCount");
  const leaveStartInput = document.getElementById("leaveStartInput");
  const leaveEndInput = document.getElementById("leaveEndInput");
  const selectedDates = document.getElementById("selectedDates");
  const timetableDay = document.getElementById("timetableDay");
  const timetableCourse = document.getElementById("timetableCourse");
  const timetableCount = document.getElementById("timetableCount");
  const timetableList = document.getElementById("timetableList");
  const timetableFile = document.getElementById("timetableFile");
  const timetableUploadPreview = document.getElementById("timetableUploadPreview");

  let latestCourses = [];
  let plannerState = { dates: [], enabledCourses: {}, timetable: {}, upload: null };

  document.getElementById("openAttendance").addEventListener("click", openAttendancePage);
  document.getElementById("openAttendanceEmpty").addEventListener("click", openAttendancePage);
  document.getElementById("refreshData").addEventListener("click", refreshFromActiveTab);
  document.getElementById("addLeaveRange").addEventListener("click", addLeaveRange);
  document.getElementById("clearLeaveDates").addEventListener("click", clearLeaveDates);
  document.getElementById("addTimetableEntry").addEventListener("click", addTimetableEntry);
  document.getElementById("clearTimetable").addEventListener("click", clearTimetable);
  document.getElementById("clearTimetableUpload").addEventListener("click", clearTimetableUpload);
  timetableFile.addEventListener("change", handleTimetableUpload);

  renderDayOptions();

  chrome.storage.local.get([STORAGE_KEY, PLANNER_KEY], (result) => {
    plannerState = normalizePlanner(result[PLANNER_KEY]);
    render(result[STORAGE_KEY]);
    refreshFromActiveTab();
  });

  function openAttendancePage() {
    chrome.tabs.create({ url: ATTENDANCE_URL });
  }

  function refreshFromActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id || !tab.url || !tab.url.startsWith(ATTENDANCE_URL)) {
        loadCachedData();
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: "AAE_GET_ATTENDANCE" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.courses) {
          loadCachedData();
          return;
        }
        render(response);
      });
    });
  }

  function loadCachedData() {
    chrome.storage.local.get([STORAGE_KEY, PLANNER_KEY], (result) => {
      plannerState = normalizePlanner(result[PLANNER_KEY]);
      render(result[STORAGE_KEY]);
    });
  }

  function render(data) {
    const courses = data && Array.isArray(data.courses) ? data.courses : [];
    latestCourses = courses;
    ensureCourseDefaults(courses);
    courseList.innerHTML = "";
    renderCourseOptions(courses);
    renderUploadPreview();
    renderTimetable();
    renderSelectedDates();

    if (!courses.length) {
      summary.hidden = true;
      timetableUpload.hidden = false;
      timetable.hidden = true;
      planner.hidden = true;
      emptyState.hidden = false;
      return;
    }

    emptyState.hidden = true;
    summary.hidden = false;
    timetableUpload.hidden = false;
    timetable.hidden = false;
    planner.hidden = false;

    const average = courses.reduce((sum, course) => sum + course.percentage, 0) / courses.length;
    const safe = courses.filter((course) => course.status === "safe").length;

    averageValue.textContent = `${average.toFixed(1)}%`;
    courseCount.textContent = `${courses.length} course${courses.length === 1 ? "" : "s"}`;
    safeCount.textContent = safe;

    courses
      .slice()
      .sort((a, b) => a.percentage - b.percentage)
      .forEach((course) => courseList.appendChild(createCourseCard(course)));
  }

  function createCourseCard(course) {
    const card = document.createElement("article");
    card.className = `aae-card aae-${course.status}`;

    const courseId = getCourseId(course);
    const isEnabled = plannerState.enabledCourses[courseId] !== false;
    const plannedMisses = countMissesForCourse(courseId, isEnabled);
    const projected = projectCourse(course, plannedMisses);
    const timetableLabel = plannedMisses
      ? `${plannedMisses} planned missed class${plannedMisses === 1 ? "" : "es"}`
      : "No planned class missed";

    const title = document.createElement("div");
    title.className = "aae-card-title";
    title.innerHTML = `<strong>${escapeHtml(course.name)}</strong><span>${escapeHtml(course.code || "Course")}</span>`;

    const meter = document.createElement("div");
    meter.className = "aae-meter";
    meter.innerHTML = [
      `<span class="aae-meter-current" style="width:${clampPercent(course.percentage)}%"></span>`,
      `<span class="aae-meter-projected" style="width:${clampPercent(projected.percentage)}%"></span>`
    ].join("");

    const stats = document.createElement("div");
    stats.className = "aae-stats";
    stats.innerHTML = [
      `<span>${course.percentage.toFixed(1)}% now</span>`,
      `<span>${projected.percentage.toFixed(1)}% after leave</span>`
    ].join("");

    const leave = document.createElement("div");
    leave.className = "aae-leave-line";
    leave.innerHTML = [
      `<strong>${course.leaveDays} leave day${course.leaveDays === 1 ? "" : "s"}</strong> available`,
      `<span>${plannedMisses ? `-${projected.loss.toFixed(1)}%` : "No loss"}</span>`
    ].join("");

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "aae-course-toggle";
    toggleLabel.innerHTML = `<input type="checkbox" ${isEnabled ? "checked" : ""}> ${timetableLabel}`;
    toggleLabel.querySelector("input").addEventListener("change", (event) => {
      plannerState.enabledCourses[courseId] = event.target.checked;
      savePlanner();
      render({ courses: latestCourses });
    });

    const advice = document.createElement("p");
    advice.className = "aae-advice";
    advice.textContent = projected.percentage >= TARGET_PERCENTAGE
      ? `After this plan, you can still miss ${projected.bunkable} more class${projected.bunkable === 1 ? "" : "es"}.`
      : `This plan drops below 75%. Attend ${projected.recovery} extra class${projected.recovery === 1 ? "" : "es"} to recover.`;

    card.append(title, meter, stats, leave, toggleLabel, advice);
    return card;
  }

  function addLeaveRange() {
    const start = leaveStartInput.value;
    const end = leaveEndInput.value || start;
    const dates = expandDateRange(start, end);
    if (!dates.length) return;

    plannerState.dates = Array.from(new Set(plannerState.dates.concat(dates))).sort();
    leaveStartInput.value = "";
    leaveEndInput.value = "";
    savePlanner();
    render({ courses: latestCourses });
  }

  function clearLeaveDates() {
    plannerState.dates = [];
    savePlanner();
    render({ courses: latestCourses });
  }

  function addTimetableEntry() {
    const day = timetableDay.value;
    const courseId = timetableCourse.value;
    const count = Math.max(1, Math.min(8, Number(timetableCount.value) || 1));
    if (!day || !courseId) return;

    const dayEntries = plannerState.timetable[day] || [];
    const existing = dayEntries.find((entry) => entry.courseId === courseId);
    if (existing) {
      existing.count = Math.max(1, Math.min(8, existing.count + count));
    } else {
      dayEntries.push({ courseId, count });
    }
    plannerState.timetable[day] = dayEntries;
    timetableCount.value = "1";
    savePlanner();
    render({ courses: latestCourses });
  }

  function clearTimetable() {
    plannerState.timetable = {};
    savePlanner();
    render({ courses: latestCourses });
  }

  function handleTimetableUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      timetableUploadPreview.innerHTML = `<p class="aae-upload-error">File is too large. Please upload a file under 4 MB.</p>`;
      timetableFile.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      plannerState.upload = {
        name: file.name,
        type: file.type || "application/octet-stream",
        dataUrl: String(reader.result || "")
      };
      timetableFile.value = "";
      savePlanner();
      render({ courses: latestCourses });
    };
    reader.readAsDataURL(file);
  }

  function clearTimetableUpload() {
    plannerState.upload = null;
    timetableFile.value = "";
    savePlanner();
    render({ courses: latestCourses });
  }

  function renderUploadPreview() {
    const upload = plannerState.upload;
    if (!upload || !upload.dataUrl) {
      timetableUploadPreview.innerHTML = `<span class="aae-date-empty">No timetable uploaded</span>`;
      return;
    }

    const preview = upload.type.startsWith("image/")
      ? `<img src="${upload.dataUrl}" alt="Uploaded timetable preview">`
      : upload.type === "application/pdf"
        ? `<embed src="${upload.dataUrl}" type="application/pdf">`
        : "";

    timetableUploadPreview.innerHTML = `
      <div class="aae-upload-meta">
        <strong>${escapeHtml(upload.name)}</strong>
        <span>${escapeHtml(upload.type || "file")}</span>
      </div>
      ${preview || `<p class="aae-date-empty">Preview unavailable for this file type.</p>`}
    `;
  }

  function renderSelectedDates() {
    selectedDates.innerHTML = "";
    if (!plannerState.dates.length) {
      selectedDates.innerHTML = `<span class="aae-date-empty">No leave dates selected</span>`;
      return;
    }

    plannerState.dates.forEach((date) => {
      const chip = document.createElement("button");
      chip.className = "aae-date-chip";
      chip.type = "button";
      chip.textContent = `${formatDate(date)} ${getDayLabel(getWeekday(date))} x`;
      chip.title = "Remove date";
      chip.addEventListener("click", () => {
        plannerState.dates = plannerState.dates.filter((item) => item !== date);
        savePlanner();
        render({ courses: latestCourses });
      });
      selectedDates.appendChild(chip);
    });
  }

  function renderDayOptions() {
    timetableDay.innerHTML = DAYS.map((day) => `<option value="${day.value}">${day.label}</option>`).join("");
  }

  function renderCourseOptions(courses) {
    timetableCourse.innerHTML = courses.map((course) => {
      const id = getCourseId(course);
      return `<option value="${escapeHtml(id)}">${escapeHtml(course.code || course.name)}</option>`;
    }).join("");
  }

  function renderTimetable() {
    timetableList.innerHTML = "";
    const hasEntries = DAYS.some((day) => (plannerState.timetable[day.value] || []).length);
    if (!hasEntries) {
      timetableList.innerHTML = `<span class="aae-date-empty">No weekly classes added yet</span>`;
      return;
    }

    DAYS.forEach((day) => {
      const entries = plannerState.timetable[day.value] || [];
      if (!entries.length) return;

      const group = document.createElement("div");
      group.className = "aae-timetable-day";
      const chips = entries.map((entry, index) => {
        const course = findCourse(entry.courseId);
        const label = course ? course.code || course.name : "Course";
        return `<button class="aae-date-chip" data-day="${day.value}" data-index="${index}" type="button" title="Remove class">${escapeHtml(label)} x${entry.count}</button>`;
      }).join("");
      group.innerHTML = `<strong>${day.label}</strong><div>${chips}</div>`;
      group.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => removeTimetableEntry(button.dataset.day, Number(button.dataset.index)));
      });
      timetableList.appendChild(group);
    });
  }

  function removeTimetableEntry(day, index) {
    const entries = plannerState.timetable[day] || [];
    entries.splice(index, 1);
    if (entries.length) {
      plannerState.timetable[day] = entries;
    } else {
      delete plannerState.timetable[day];
    }
    savePlanner();
    render({ courses: latestCourses });
  }

  function countMissesForCourse(courseId, isEnabled) {
    if (!isEnabled) return 0;
    return plannerState.dates.reduce((sum, date) => {
      const day = getWeekday(date);
      const entries = plannerState.timetable[day] || [];
      if (entries.length) {
        return sum + entries
          .filter((entry) => entry.courseId === courseId)
          .reduce((entrySum, entry) => entrySum + Math.max(1, Number(entry.count) || 1), 0);
      }
      return sum + 1;
    }, 0);
  }

  function projectCourse(course, missedClasses) {
    const total = course.total + missedClasses;
    const presentEffective = course.presentEffective;
    const percentage = total > 0 ? (presentEffective / total) * 100 : 0;
    const bunkable = percentage >= TARGET_PERCENTAGE
      ? Math.max(0, Math.floor((presentEffective * 100 / TARGET_PERCENTAGE) - total))
      : 0;
    const recovery = percentage < TARGET_PERCENTAGE
      ? Math.ceil(((TARGET_PERCENTAGE * total) - (presentEffective * 100)) / (100 - TARGET_PERCENTAGE))
      : 0;

    return {
      total,
      percentage,
      loss: Math.max(0, course.percentage - percentage),
      bunkable,
      recovery: Math.max(0, recovery)
    };
  }

  function expandDateRange(startValue, endValue) {
    if (!startValue || !endValue) return [];
    const start = new Date(`${startValue}T12:00:00`);
    const end = new Date(`${endValue}T12:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

    const first = start <= end ? start : end;
    const last = start <= end ? end : start;
    const dates = [];
    const current = new Date(first);
    while (current <= last && dates.length < 90) {
      dates.push(toDateInputValue(current));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  function ensureCourseDefaults(courses) {
    courses.forEach((course) => {
      const id = getCourseId(course);
      if (plannerState.enabledCourses[id] === undefined) {
        plannerState.enabledCourses[id] = true;
      }
    });
    savePlanner();
  }

  function savePlanner() {
    chrome.storage.local.set({ [PLANNER_KEY]: plannerState });
  }

  function normalizePlanner(value) {
    return {
      dates: Array.isArray(value && value.dates) ? value.dates.filter(Boolean).sort() : [],
      enabledCourses: value && value.enabledCourses && typeof value.enabledCourses === "object" ? value.enabledCourses : {},
      timetable: normalizeTimetable(value && value.timetable),
      upload: normalizeUpload(value && value.upload)
    };
  }

  function normalizeTimetable(value) {
    const timetableMap = {};
    if (!value || typeof value !== "object") return timetableMap;
    Object.keys(value).forEach((day) => {
      const entries = Array.isArray(value[day]) ? value[day] : [];
      timetableMap[day] = entries
        .filter((entry) => entry && entry.courseId)
        .map((entry) => ({
          courseId: String(entry.courseId),
          count: Math.max(1, Math.min(8, Number(entry.count) || 1))
        }));
    });
    return timetableMap;
  }

  function normalizeUpload(value) {
    if (!value || typeof value !== "object" || !value.dataUrl) return null;
    return {
      name: String(value.name || "Timetable"),
      type: String(value.type || "application/octet-stream"),
      dataUrl: String(value.dataUrl)
    };
  }

  function getCourseId(course) {
    return `${course.code || ""}|${course.name || ""}`;
  }

  function findCourse(courseId) {
    return latestCourses.find((course) => getCourseId(course) === courseId);
  }

  function getWeekday(dateValue) {
    const date = new Date(`${dateValue}T12:00:00`);
    return String(date.getDay());
  }

  function getDayLabel(value) {
    const day = DAYS.find((item) => item.value === String(value));
    return day ? day.label.slice(0, 3) : "";
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function formatDate(value) {
    const parts = value.split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : value;
  }

  function toDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }
})();
