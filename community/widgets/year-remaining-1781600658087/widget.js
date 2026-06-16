(() => {
  "use strict";

  const MIN_WIDTH = 260;
  const MIN_HEIGHT = 180;
  const PALETTE_KEY = "year-remaining-industrial-palette";
  const palettes = {
    signal: { background: "#09090a", surface: "#111113", text: "#f4f4f1", muted: "#858589", line: "#2b2b2e", accent: "#ff3b30" },
    graphite: { background: "#151517", surface: "#1d1d20", text: "#f2f2ef", muted: "#929297", line: "#38383c", accent: "#ff453a" },
    frost: { background: "#deded9", surface: "#eeeeea", text: "#101012", muted: "#626267", line: "#b9b9b5", accent: "#d71920" },
    void: { background: "#020203", surface: "#09090b", text: "#dedede", muted: "#707074", line: "#202023", accent: "#ff2d2d" }
  };

  const elements = {
    widget: document.querySelector(".widget"),
    currentYear: document.getElementById("currentYear"),
    targetDate: document.getElementById("targetDate"),
    secondsLeft: document.getElementById("secondsLeft"),
    daysLeft: document.getElementById("daysLeft"),
    hoursLeft: document.getElementById("hoursLeft"),
    minutesLeft: document.getElementById("minutesLeft"),
    smallSecondsLeft: document.getElementById("smallSecondsLeft"),
    secondsSpent: document.getElementById("secondsSpent"),
    dayOfYear: document.getElementById("dayOfYear"),
    weeksLeft: document.getElementById("weeksLeft"),
    progressLabel: document.getElementById("progressLabel"),
    progressBar: document.getElementById("progressBar"),
    progressTrack: document.querySelector(".progress-track"),
    resizeHandle: document.querySelector(".resize-handle"),
    paletteMenu: document.getElementById("paletteMenu"),
    paletteTrigger: document.getElementById("paletteTrigger"),
    paletteClose: document.getElementById("paletteClose"),
    backgroundPicker: document.getElementById("backgroundPicker"),
    accentPicker: document.getElementById("accentPicker"),
    textPicker: document.getElementById("textPicker")
  };

  const numberFormatter = new Intl.NumberFormat(undefined);
  const targetDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric"
  });

  function applyPalette(palette, persist = true) {
    Object.entries(palette).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--${key}`, value);
    });

    elements.backgroundPicker.value = palette.background;
    elements.accentPicker.value = palette.accent;
    elements.textPicker.value = palette.text;

    document.querySelectorAll("[data-palette]").forEach((button) => {
      const preset = palettes[button.dataset.palette];
      const active = Object.keys(preset).every((key) => preset[key] === palette[key]);
      button.setAttribute("aria-pressed", String(active));
    });

    if (persist) {
      try {
        localStorage.setItem(PALETTE_KEY, JSON.stringify(palette));
      } catch {
        // Persistence is optional when the host disables local storage.
      }
    }
  }

  function currentPalette() {
    const styles = getComputedStyle(document.documentElement);
    return {
      background: styles.getPropertyValue("--background").trim(),
      surface: styles.getPropertyValue("--surface").trim(),
      text: styles.getPropertyValue("--text").trim(),
      muted: styles.getPropertyValue("--muted").trim(),
      line: styles.getPropertyValue("--line").trim(),
      accent: styles.getPropertyValue("--accent").trim()
    };
  }

  function loadPalette() {
    try {
      const saved = JSON.parse(localStorage.getItem(PALETTE_KEY));
      if (saved && saved.background && saved.text && saved.accent) {
        applyPalette({ ...palettes.signal, ...saved }, false);
        return;
      }
    } catch {
      // Fall through to the default signal palette.
    }
    applyPalette(palettes.signal, false);
  }

  function openPaletteMenuAt(x, y) {
    elements.paletteMenu.hidden = false;
    elements.paletteTrigger.setAttribute("aria-expanded", "true");
    const rect = elements.paletteMenu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    elements.paletteMenu.style.left = `${Math.max(8, left)}px`;
    elements.paletteMenu.style.top = `${Math.max(8, top)}px`;
  }

  function openPaletteMenu(event) {
    event.preventDefault();
    openPaletteMenuAt(event.clientX, event.clientY);
  }

  function closePaletteMenu() {
    elements.paletteMenu.hidden = true;
    elements.paletteTrigger.setAttribute("aria-expanded", "false");
  }

  function pulseSecond() {
    elements.widget.classList.remove("second-tick");
    window.requestAnimationFrame(() => elements.widget.classList.add("second-tick"));
  }

  function render() {
    const now = new Date();
    const year = now.getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);
    const elapsedMs = Math.max(0, now.getTime() - start.getTime());
    const remainingMs = Math.max(0, end.getTime() - now.getTime());
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const yearLength = Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000);
    const currentDay = Math.min(
      yearLength,
      Math.floor((Date.UTC(year, now.getMonth(), now.getDate()) - Date.UTC(year, 0, 1)) / 86400000) + 1
    );
    const progress = Math.min(100, Math.max(0, elapsedMs / (end.getTime() - start.getTime()) * 100));

    elements.currentYear.textContent = String(year);
    elements.targetDate.textContent = targetDateFormatter.format(end).toUpperCase();
    elements.secondsLeft.textContent = numberFormatter.format(totalSeconds);
    elements.daysLeft.textContent = numberFormatter.format(days);
    elements.hoursLeft.textContent = String(hours).padStart(2, "0");
    elements.minutesLeft.textContent = String(minutes).padStart(2, "0");
    elements.smallSecondsLeft.textContent = String(seconds).padStart(2, "0");
    elements.secondsSpent.textContent = `${numberFormatter.format(elapsedSeconds)} SEC`;
    elements.dayOfYear.textContent = `DAY ${currentDay} / ${yearLength}`;
    elements.weeksLeft.textContent = `${Math.ceil(days / 7)} WEEKS`;
    elements.progressLabel.textContent = `${progress.toFixed(1)}%`;
    elements.progressBar.style.width = `${progress}%`;
    elements.progressTrack.setAttribute("aria-valuenow", progress.toFixed(2));
    pulseSecond();

    const delay = Math.max(50, 1000 - (Date.now() % 1000) + 8);
    window.setTimeout(render, delay);
  }

  function startResize(event) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    closePaletteMenu();

    const startX = event.screenX;
    const startY = event.screenY;
    const startWidth = window.outerWidth || document.documentElement.clientWidth;
    const startHeight = window.outerHeight || document.documentElement.clientHeight;
    let resizing = false;
    elements.resizeHandle.setPointerCapture(event.pointerId);

    function moveResize(moveEvent) {
      const deltaX = moveEvent.screenX - startX;
      const deltaY = moveEvent.screenY - startY;
      if (!resizing && Math.hypot(deltaX, deltaY) < 6) return;
      if (!resizing) {
        resizing = true;
        document.body.classList.add("is-resizing");
      }

      const width = Math.max(MIN_WIDTH, Math.round(startWidth + deltaX));
      const height = Math.max(MIN_HEIGHT, Math.round(startHeight + deltaY));
      if (window.parent === window) {
        window.resizeTo(width, height);
      } else {
        window.parent.postMessage({ type: "widget-resize", width, height }, "*");
      }
    }

    function stopResize() {
      document.body.classList.remove("is-resizing");
      elements.resizeHandle.removeEventListener("pointermove", moveResize);
      elements.resizeHandle.removeEventListener("pointerup", stopResize);
      elements.resizeHandle.removeEventListener("pointercancel", stopResize);
    }

    elements.resizeHandle.addEventListener("pointermove", moveResize);
    elements.resizeHandle.addEventListener("pointerup", stopResize);
    elements.resizeHandle.addEventListener("pointercancel", stopResize);
  }

  elements.resizeHandle.addEventListener("pointerdown", startResize);
  elements.paletteTrigger.addEventListener("click", () => {
    if (!elements.paletteMenu.hidden) {
      closePaletteMenu();
      return;
    }
    const rect = elements.paletteTrigger.getBoundingClientRect();
    openPaletteMenuAt(rect.right, rect.bottom + 7);
  });
  elements.paletteClose.addEventListener("click", closePaletteMenu);

  elements.widget.addEventListener("pointerdown", (event) => {
    if (event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      openPaletteMenu(event);
    }
  }, true);

  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (elements.widget.contains(event.target)) openPaletteMenu(event);
  }, true);

  document.addEventListener("auxclick", (event) => {
    if (event.button === 2) event.preventDefault();
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (
      !elements.paletteMenu.hidden &&
      !elements.paletteMenu.contains(event.target) &&
      !elements.paletteTrigger.contains(event.target)
    ) closePaletteMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePaletteMenu();
  });

  document.querySelectorAll("[data-palette]").forEach((button) => {
    button.addEventListener("click", () => {
      applyPalette(palettes[button.dataset.palette]);
      closePaletteMenu();
    });
  });

  elements.backgroundPicker.addEventListener("input", () => {
    applyPalette({ ...currentPalette(), background: elements.backgroundPicker.value });
  });
  elements.accentPicker.addEventListener("input", () => {
    applyPalette({ ...currentPalette(), accent: elements.accentPicker.value });
  });
  elements.textPicker.addEventListener("input", () => {
    applyPalette({ ...currentPalette(), text: elements.textPicker.value });
  });

  loadPalette();
  render();
})();
