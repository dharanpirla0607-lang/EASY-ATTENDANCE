(function () {
  const TARGET_PERCENTAGE = 75;
  const STORAGE_KEY = "amritaAttendanceData";
  const WIDGET_ID = "aae-widget";
  const SIZE_KEY = "aaeWidgetSize";
  const HEADER_ALIASES = {
    code: ["course code", "code", "subject code"],
    name: ["course title", "course name", "subject", "subject name", "course"],
    total: ["total", "total classes", "classes held", "conducted"],
    present: ["present", "attended", "classes attended"],
    dutyLeave: ["duty leave", "duty", "dl"],
    absent: ["absent", "absence"],
    medicalLeave: ["medical leave", "medical", "ml"],
    percentage: ["percentage", "%", "attendance %", "attendance percentage"]
  };

  let lastSignature = "";
  let retryCount = 0;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "AAE_GET_ATTENDANCE") {
      const payload = collectAndStore(true);
      sendResponse(payload);
    }
    return true;
  });

  waitForAttendance();

  function waitForAttendance() {
    const payload = collectAndStore(false);
    if (payload.courses.length || retryCount > 12) {
      watchForChanges();
      return;
    }

    retryCount += 1;
    window.setTimeout(waitForAttendance, Math.min(8000, 500 * retryCount));
  }

  function watchForChanges() {
    const observer = new MutationObserver(() => {
      window.clearTimeout(watchForChanges.timer);
      watchForChanges.timer = window.setTimeout(() => collectAndStore(false), 300);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function collectAndStore(forceRender) {
    const courses = parseAttendanceTables();
    const payload = {
      courses,
      updatedAt: new Date().toISOString(),
      url: location.href
    };

    const signature = JSON.stringify(courses);
    if (forceRender || signature !== lastSignature) {
      lastSignature = signature;
      chrome.storage.local.set({ [STORAGE_KEY]: payload });
      renderWidget(payload);
    }

    return payload;
  }

  function parseAttendanceTables() {
    const rows = [];
    document.querySelectorAll("table").forEach((table) => {
      rows.push(...parseTable(table));
    });

    return rows
      .filter((course) => course.total > 0 && (course.name || course.code))
      .map(enrichCourse);
  }

  function parseTable(table) {
    const rowElements = Array.from(table.querySelectorAll("tr"));
    if (!rowElements.length) return [];

    const headerRow = rowElements.find((row) => Array.from(row.cells).some((cell) => hasHeaderMatch(cell.textContent)));
    if (!headerRow) return parseFallbackRows(rowElements);

    const headers = Array.from(headerRow.cells).map((cell) => normalize(cell.textContent));
    const map = buildHeaderMap(headers);
    const dataRows = rowElements.slice(rowElements.indexOf(headerRow) + 1);

    return dataRows.map((row) => parseMappedRow(Array.from(row.cells), map)).filter(Boolean);
  }

  function parseMappedRow(cells, map) {
    if (cells.length < 3) return null;

    const get = (key) => {
      const index = map[key];
      return Number.isInteger(index) && cells[index] ? clean(cells[index].textContent) : "";
    };

    const present = toNumber(get("present"));
    const dutyLeave = toNumber(get("dutyLeave"));
    const total = toNumber(get("total"));
    const percentage = toNumber(get("percentage"));

    return {
      code: get("code"),
      name: get("name") || get("code"),
      total: total || inferTotalFromPercentage(present + dutyLeave, percentage),
      present,
      dutyLeave,
      absent: toNumber(get("absent")),
      medicalLeave: toNumber(get("medicalLeave")),
      source: "header"
    };
  }

  function parseFallbackRows(rowElements) {
    return rowElements.map((row) => {
      const values = Array.from(row.cells).map((cell) => clean(cell.textContent)).filter(Boolean);
      if (values.length < 4 || !values.some((value) => /\d/.test(value))) return null;

      const numbers = values.map(toNumber).filter((value) => value > 0);
      if (numbers.length < 2) return null;

      const total = Math.max(...numbers);
      const present = numbers.find((value) => value <= total) || 0;
      const code = values.find((value) => /^[A-Z]{2,}\d|\d{2}[A-Z]/i.test(value)) || "";
      const name = values.find((value) => value !== code && /[a-z]/i.test(value)) || code || "Course";

      return { code, name, total, present, dutyLeave: 0, absent: Math.max(0, total - present), medicalLeave: 0, source: "fallback" };
    }).filter(Boolean);
  }

  function enrichCourse(course) {
    const presentEffective = Math.max(0, course.present + course.dutyLeave);
    const percentage = course.total > 0 ? (presentEffective / course.total) * 100 : 0;
    const bunkable = percentage >= TARGET_PERCENTAGE
      ? Math.max(0, Math.floor((presentEffective * 100 / TARGET_PERCENTAGE) - course.total))
      : 0;
    const recovery = percentage < TARGET_PERCENTAGE
      ? Math.ceil(((TARGET_PERCENTAGE * course.total) - (presentEffective * 100)) / (100 - TARGET_PERCENTAGE))
      : 0;

    return {
      ...course,
      presentEffective,
      percentage,
      bunkable,
      leaveDays: bunkable,
      recovery: Math.max(0, recovery),
      status: percentage >= TARGET_PERCENTAGE ? "safe" : percentage >= 70 ? "warning" : "danger"
    };
  }

  function renderWidget(payload) {
    let widget = document.getElementById(WIDGET_ID);
    if (!widget) {
      widget = document.createElement("aside");
      widget.id = WIDGET_ID;
      widget.className = `aae-widget-${getSavedSize()}`;
      widget.innerHTML = `
        <div class="aae-widget-head">
          <div>
            <span class="aae-widget-kicker">Amrita</span>
            <strong>Attendance</strong>
          </div>
          <div class="aae-widget-actions">
            <button class="aae-size-btn" data-size="small" type="button" title="Small widget">S</button>
            <button class="aae-size-btn" data-size="medium" type="button" title="Medium widget">M</button>
            <button class="aae-size-btn" data-size="large" type="button" title="Large widget">L</button>
            <button class="aae-widget-toggle" type="button" title="Collapse">-</button>
          </div>
        </div>
        <div class="aae-widget-body"></div>
      `;
      document.body.appendChild(widget);
      makeDraggable(widget);
      bindWidgetControls(widget);
    }

    setWidgetSize(widget, getSavedSize());
    const body = widget.querySelector(".aae-widget-body");
    const courses = payload.courses || [];
    if (!courses.length) {
      body.innerHTML = `<p class="aae-widget-empty">Waiting for attendance table...</p>`;
      return;
    }

    const average = courses.reduce((sum, course) => sum + course.percentage, 0) / courses.length;
    const lowest = courses.slice().sort((a, b) => a.percentage - b.percentage)[0];
    body.innerHTML = `
      <div class="aae-widget-summary">
        <div>
          <span class="aae-widget-average">${average.toFixed(1)}%</span>
          <small>Overall average</small>
        </div>
        <div class="aae-widget-pill ${lowest.status}">Lowest ${lowest.percentage.toFixed(1)}%</div>
      </div>
      <div class="aae-widget-list">
        ${courses
          .slice()
          .sort((a, b) => a.percentage - b.percentage)
          .map((course) => renderCourseRow(course))
          .join("")}
      </div>
    `;
  }

  function renderCourseRow(course) {
    return `
      <div class="aae-widget-row aae-${course.status}">
        <div class="aae-widget-row-top">
          <span title="${escapeHtml(course.name)}">${escapeHtml(course.code || course.name)}</span>
          <strong>${course.percentage.toFixed(1)}%</strong>
        </div>
        <div class="aae-widget-bar" aria-hidden="true">
          <span style="width:${clampPercent(course.percentage)}%"></span>
          <i></i>
        </div>
        <div class="aae-widget-row-bottom">
          <small>${course.presentEffective}/${course.total} attended</small>
          <small>${course.percentage >= TARGET_PERCENTAGE ? `${course.leaveDays} leave days` : `${course.recovery} to recover`}</small>
        </div>
      </div>
    `;
  }

  function bindWidgetControls(widget) {
    widget.querySelector(".aae-widget-toggle").addEventListener("click", () => {
      widget.classList.toggle("aae-collapsed");
    });

    widget.querySelectorAll(".aae-size-btn").forEach((button) => {
      button.addEventListener("click", () => {
        setWidgetSize(widget, button.dataset.size);
        localStorage.setItem(SIZE_KEY, button.dataset.size);
      });
    });
  }

  function setWidgetSize(widget, size) {
    ["small", "medium", "large"].forEach((item) => {
      widget.classList.toggle(`aae-widget-${item}`, item === size);
    });
    widget.querySelectorAll(".aae-size-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.size === size);
    });
  }

  function getSavedSize() {
    const size = localStorage.getItem(SIZE_KEY);
    return ["small", "medium", "large"].includes(size) ? size : "medium";
  }

  function makeDraggable(widget) {
    const saved = JSON.parse(localStorage.getItem("aaeWidgetPosition") || "null");
    if (saved) {
      widget.style.left = `${saved.left}px`;
      widget.style.top = `${saved.top}px`;
      widget.style.right = "auto";
    }

    const handle = widget.querySelector(".aae-widget-head");
    let start = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      start = {
        x: event.clientX,
        y: event.clientY,
        left: widget.offsetLeft,
        top: widget.offsetTop
      };
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener("pointermove", (event) => {
      if (!start) return;
      const left = Math.max(8, Math.min(window.innerWidth - widget.offsetWidth - 8, start.left + event.clientX - start.x));
      const top = Math.max(8, Math.min(window.innerHeight - widget.offsetHeight - 8, start.top + event.clientY - start.y));
      widget.style.left = `${left}px`;
      widget.style.top = `${top}px`;
      widget.style.right = "auto";
    });

    handle.addEventListener("pointerup", () => {
      if (!start) return;
      localStorage.setItem("aaeWidgetPosition", JSON.stringify({ left: widget.offsetLeft, top: widget.offsetTop }));
      start = null;
    });
  }

  function buildHeaderMap(headers) {
    return Object.fromEntries(Object.keys(HEADER_ALIASES).map((key) => {
      const index = headers.findIndex((header) => HEADER_ALIASES[key].some((alias) => header.includes(alias)));
      return [key, index >= 0 ? index : null];
    }));
  }

  function hasHeaderMatch(value) {
    const text = normalize(value);
    return Object.values(HEADER_ALIASES).flat().some((alias) => text.includes(alias));
  }

  function inferTotalFromPercentage(present, percentage) {
    return percentage > 0 ? Math.round((present * 100) / percentage) : 0;
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalize(value) {
    return clean(value).toLowerCase();
  }

  function toNumber(value) {
    const match = String(value || "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
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