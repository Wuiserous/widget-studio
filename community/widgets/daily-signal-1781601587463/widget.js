(function () {
  "use strict";

  const STORAGE_KEY = "daily-signal-habit-v1";
  const dayMs = 86400000;
  let now = new Date();

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed && Array.isArray(parsed.completed)) {
        return { completed: [...new Set(parsed.completed)] };
      }
    } catch (error) {
      console.warn("Habit state could not be loaded.", error);
    }
    return { completed: [] };
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function calculateStreak(completed) {
    const done = new Set(completed);
    let cursor = new Date(now);
    if (!done.has(dateKey(cursor))) {
      cursor = addDays(cursor, -1);
    }
    let streak = 0;
    while (done.has(dateKey(cursor))) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  function calculateBest(completed) {
    const sorted = completed
      .map((key) => new Date(`${key}T12:00:00`))
      .sort((a, b) => a - b);
    let best = 0;
    let run = 0;
    let previous = null;

    sorted.forEach((date) => {
      if (!previous) {
        run = 1;
      } else {
        const difference = Math.round((date - previous) / dayMs);
        run = difference === 1 ? run + 1 : 1;
      }
      best = Math.max(best, run);
      previous = date;
    });
    return best;
  }

  const state = loadState();
  const elements = {
    widget: document.getElementById("widget"),
    dateCode: document.getElementById("dateCode"),
    streakValue: document.getElementById("streakValue"),
    statusMark: document.getElementById("statusMark"),
    todayDay: document.getElementById("todayDay"),
    timeCue: document.getElementById("timeCue"),
    todayState: document.getElementById("todayState"),
    checkButton: document.getElementById("checkButton"),
    buttonText: document.getElementById("buttonText"),
    weekStrip: document.getElementById("weekStrip"),
    weekScore: document.getElementById("weekScore"),
    heatMap: document.getElementById("heatMap"),
    bestValue: document.getElementById("bestValue"),
    rateValue: document.getElementById("rateValue"),
    message: document.getElementById("message")
  };

  function getTimeState(todayDone, streak) {
    if (todayDone) {
      return {
        phase: "complete",
        cue: "SECURED",
        state: "SIGNAL LOGGED",
        button: "COMPLETED",
        message: "CHAIN SECURED. PRESSURE OFF."
      };
    }

    const hour = now.getHours();
    const minute = now.getMinutes();
    const minutesElapsed = (hour * 60) + minute;
    const minutesLeft = Math.max(1, 1440 - minutesElapsed);
    const timeLeft = minutesLeft < 60
      ? `${minutesLeft}M LEFT`
      : `${Math.ceil(minutesLeft / 60)}H LEFT`;

    if (hour < 12) {
      return {
        phase: "morning",
        cue: timeLeft,
        state: "DAY OPEN",
        button: "MARK DONE",
        message: "BANK THE WIN EARLY. FREE THE REST OF YOUR DAY."
      };
    }

    if (hour < 17) {
      return {
        phase: "afternoon",
        cue: timeLeft,
        state: "MOMENTUM WINDOW",
        button: "MARK DONE",
        message: "ACT NOW BEFORE THE DAY GETS LOUDER."
      };
    }

    if (hour < 21) {
      return {
        phase: "evening",
        cue: timeLeft,
        state: streak > 0 ? "STREAK AT RISK" : "TODAY STILL OPEN",
        button: "CHECK IN NOW",
        message: streak > 0
          ? `${streak}-DAY CHAIN NEEDS TODAY'S SIGNAL.`
          : "CLOSE THE LOOP BEFORE MIDNIGHT."
      };
    }

    return {
      phase: "late",
      cue: timeLeft,
      state: "FINAL WINDOW",
      button: "CHECK IN NOW",
      message: streak > 0
        ? `FINAL WINDOW. PROTECT YOUR ${streak}-DAY CHAIN.`
        : "ONE ACTION STILL CHANGES TODAY."
    };
  }

  function renderWeek(done) {
    elements.weekStrip.replaceChildren();
    let score = 0;

    for (let offset = -6; offset <= 0; offset += 1) {
      const date = addDays(now, offset);
      const isDone = done.has(dateKey(date));
      const cell = document.createElement("div");
      cell.className = `day-cell${isDone ? " done" : ""}${offset === 0 ? " today" : ""}`;
      cell.textContent = date.toLocaleDateString("en-US", { weekday: "narrow" });
      cell.title = `${date.toLocaleDateString()} — ${isDone ? "complete" : "not complete"}`;
      elements.weekStrip.appendChild(cell);
      if (isDone) score += 1;
    }
    elements.weekScore.textContent = `${score}/7`;
  }

  function renderHeatMap(done) {
    elements.heatMap.replaceChildren();
    const start = addDays(now, -83);

    for (let index = 0; index < 84; index += 1) {
      const date = addDays(start, index);
      const cell = document.createElement("span");
      const isDone = done.has(dateKey(date));
      cell.className = `heat-cell${isDone ? " done" : ""}`;
      cell.title = `${date.toLocaleDateString()} — ${isDone ? "complete" : "not complete"}`;
      elements.heatMap.appendChild(cell);
    }
  }

  function render() {
    const done = new Set(state.completed);
    const todayKey = dateKey(now);
    const todayDone = done.has(todayKey);
    const streak = calculateStreak(state.completed);
    const best = calculateBest(state.completed);
    const timeState = getTimeState(todayDone, streak);
    const minutesElapsed = (now.getHours() * 60) + now.getMinutes();
    let last30 = 0;

    for (let offset = -29; offset <= 0; offset += 1) {
      if (done.has(dateKey(addDays(now, offset)))) last30 += 1;
    }

    elements.dateCode.textContent = now.toLocaleDateString("en-CA").replaceAll("-", ".");
    elements.todayDay.textContent = now.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
    elements.timeCue.textContent = timeState.cue;
    elements.streakValue.textContent = streak;
    elements.todayState.textContent = timeState.state;
    elements.buttonText.textContent = timeState.button;
    elements.checkButton.setAttribute("aria-pressed", String(todayDone));
    elements.widget.dataset.phase = timeState.phase;
    elements.widget.classList.toggle("pending", !todayDone);
    elements.widget.style.setProperty("--day-progress", String(minutesElapsed / 1440));
    elements.statusMark.classList.toggle("active", todayDone);
    elements.bestValue.textContent = `${best}D`;
    elements.rateValue.textContent = `${Math.round((last30 / 30) * 100)}%`;
    elements.message.textContent = timeState.message;

    renderWeek(done);
    renderHeatMap(done);
  }

  elements.checkButton.addEventListener("click", () => {
    const todayKey = dateKey(now);
    const index = state.completed.indexOf(todayKey);
    if (index >= 0) {
      state.completed.splice(index, 1);
    } else {
      state.completed.push(todayKey);
    }
    saveState(state);
    render();
  });

  render();
  window.setInterval(() => {
    now = new Date();
    render();
  }, 60000);
})();
