(() => {
  "use strict";

  const coin = document.getElementById("coin");
  const coinScene = coin.closest(".coin-scene");
  const coinButton = document.getElementById("coinButton");
  const flipButton = document.getElementById("flipButton");
  const resetButton = document.getElementById("resetButton");
  const resultText = document.getElementById("resultText");
  const resultDetail = document.getElementById("resultDetail");
  const headsCount = document.getElementById("headsCount");
  const tailsCount = document.getElementById("tailsCount");
  const streakCount = document.getElementById("streakCount");
  const streakType = document.getElementById("streakType");
  const headsMeter = document.getElementById("headsMeter");
  const tailsMeter = document.getElementById("tailsMeter");
  const totalCount = document.getElementById("totalCount");
  const historyNode = document.getElementById("history");
  const resizeZone = document.querySelector(".resize-zone");
  const TOSS_DURATION_MS = 1850;
  const MIN_WIDGET_WIDTH = 260;
  const MIN_WIDGET_HEIGHT = 180;
  const MOTION_TIMES = [0, .08, .16, .26, .38, .5, .62, .74, .84, .92, .97, 1];
  const ANGULAR_PROGRESS = [0, .015, .07, .21, .43, .64, .79, .89, .95, .98, .995, 1];

  const state = {
    heads: 0,
    tails: 0,
    streak: 0,
    last: null,
    history: [],
    flipping: false
  };

  function randomSide() {
    if (window.crypto && window.crypto.getRandomValues) {
      const value = new Uint32Array(1);
      window.crypto.getRandomValues(value);
      return value[0] % 2 === 0 ? "HEADS" : "TAILS";
    }
    return Math.random() < 0.5 ? "HEADS" : "TAILS";
  }

  function pad(value, width = 2) {
    return String(value).padStart(width, "0");
  }

  function render() {
    const total = state.heads + state.tails;
    const headsPercent = total ? (state.heads / total) * 100 : 0;
    const tailsPercent = total ? (state.tails / total) * 100 : 0;

    headsCount.textContent = pad(state.heads);
    tailsCount.textContent = pad(state.tails);
    streakCount.textContent = pad(state.streak);
    streakType.textContent = state.last ? state.last.slice(0, 1) : "--";
    headsMeter.style.width = `${headsPercent}%`;
    tailsMeter.style.width = `${tailsPercent}%`;
    totalCount.textContent = `${pad(total, 3)} FLIPS`;

    historyNode.replaceChildren();
    if (!state.history.length) {
      const empty = document.createElement("span");
      empty.className = "history-empty";
      empty.textContent = "NO DATA CAPTURED";
      historyNode.append(empty);
      return;
    }

    state.history.slice(0, 18).forEach((side, index) => {
      const item = document.createElement("span");
      item.className = "history-item";
      item.textContent = side.slice(0, 1);
      item.title = `${index === 0 ? "Latest: " : ""}${side}`;
      historyNode.append(item);
    });
  }

  function setControlsDisabled(disabled) {
    flipButton.disabled = disabled;
    coinButton.disabled = disabled;
  }

  function between(min, max) {
    return min + Math.random() * (max - min);
  }

  function configureToss(side) {
    const start = state.last === "TAILS" ? 180 : 0;
    const target = side === "TAILS" ? 180 : 0;
    const spins = Math.floor(between(6, 9));
    const faceDelta = (target - start + 360) % 360;
    const finalTurn = start + spins * 360 + faceDelta;
    const span = finalTurn - start;

    const axisDirection = Math.random() < .5 ? -1 : 1;
    const tiltPeak = between(6, 9) * axisDirection;
    const rollPeak = between(1.2, 2.2) * axisDirection;
    const tiltEnvelope = [.25, .6, 1, .85, .65, .45, .28, .15, .06, .02];

    coin.style.setProperty("--turn-start", `${start}deg`);
    ANGULAR_PROGRESS.slice(1, -1).forEach((progress, index) => {
      const step = index + 1;
      coin.style.setProperty(`--turn-${step}`, `${start + span * progress}deg`);
      coin.style.setProperty(`--tilt-${step}`, `${tiltPeak * tiltEnvelope[index]}deg`);
      coin.style.setProperty(`--roll-${step}`, `${rollPeak * tiltEnvelope[index]}deg`);
    });
    coin.style.setProperty("--turn-final", `${finalTurn}deg`);

    const drift = between(-5, 5);
    const lift = between(-34, -29);
    const heightEnvelope = [.48, .82, .98, 1, .97, .86, .64, .4, .16];
    const driftEnvelope = [.2, .45, .72, 1, .9, .72, .5, .25, .08];

    heightEnvelope.forEach((height, index) => {
      const step = index + 1;
      coinScene.style.setProperty(`--height-${step}`, `${lift * height}px`);
      coinScene.style.setProperty(`--drift-${step}`, `${drift * driftEnvelope[index]}px`);
    });
  }

  function flip() {
    if (state.flipping) return;

    const side = randomSide();
    state.flipping = true;
    setControlsDisabled(true);
    resultText.textContent = "TOSSING";
    resultDetail.textContent = "FINGER TOSS / FREE FLIGHT";

    coin.classList.remove("is-flipping");
    coinScene.classList.remove("is-tossing");
    coin.style.setProperty("--toss-duration", `${TOSS_DURATION_MS}ms`);
    coinScene.style.setProperty("--toss-duration", `${TOSS_DURATION_MS}ms`);
    configureToss(side);
    void coin.offsetWidth;
    coin.classList.add("is-flipping");
    coinScene.classList.add("is-tossing");

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (state.last === side) {
        state.streak += 1;
      } else {
        state.streak = 1;
      }

      state.last = side;
      state[side.toLowerCase()] += 1;
      state.history.unshift(side);
      state.history = state.history.slice(0, 18);
      resultText.textContent = side;
      resultDetail.textContent = `${side === "HEADS" ? "OBVERSE" : "REVERSE"} FACE CONFIRMED`;
      coin.style.setProperty("--rest-turn", side === "TAILS" ? "180deg" : "0deg");
      coin.classList.remove("is-flipping");
      coinScene.classList.remove("is-tossing");
      render();
      state.flipping = false;
      setControlsDisabled(false);
    };

    coin.addEventListener("animationend", settle, { once: true });
    window.setTimeout(settle, TOSS_DURATION_MS + 250);
  }

  function reset() {
    if (state.flipping) return;
    state.heads = 0;
    state.tails = 0;
    state.streak = 0;
    state.last = null;
    state.history = [];
    coin.classList.remove("is-flipping");
    coinScene.classList.remove("is-tossing");
    coin.style.setProperty("--rest-turn", "0deg");
    resultText.textContent = "READY";
    resultDetail.textContent = "PRESS FLIP TO INITIALIZE";
    render();
  }

  let resizeState = null;
  let resizeFrame = 0;

  function resizeHostWindow(width, height) {
    const nextWidth = Math.max(MIN_WIDGET_WIDTH, Math.round(width));
    const nextHeight = Math.max(MIN_WIDGET_HEIGHT, Math.round(height));

    try {
      window.resizeTo(nextWidth, nextHeight);
    } catch {
      // The Electron fallback below covers hosts that disable window.resizeTo.
    }

    try {
      if (typeof window.require === "function") {
        const electron = window.require("electron");
        const currentWindow = electron?.remote?.getCurrentWindow?.();
        currentWindow?.setSize(nextWidth, nextHeight);
      }
    } catch {
      // Node integration and Electron remote are commonly disabled.
    }
  }

  function finishResize(event) {
    if (!resizeState || event.pointerId !== resizeState.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (resizeZone.hasPointerCapture(event.pointerId)) {
      resizeZone.releasePointerCapture(event.pointerId);
    }
    resizeState = null;
    document.body.classList.remove("is-resizing");
  }

  resizeZone.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    resizeState = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      startWidth: window.outerWidth || window.innerWidth,
      startHeight: window.outerHeight || window.innerHeight
    };

    resizeZone.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
  }, true);

  resizeZone.addEventListener("pointermove", (event) => {
    if (!resizeState || event.pointerId !== resizeState.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    const width = resizeState.startWidth + event.screenX - resizeState.startX;
    const height = resizeState.startHeight + event.screenY - resizeState.startY;
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(() => resizeHostWindow(width, height));
  }, true);

  resizeZone.addEventListener("pointerup", finishResize, true);
  resizeZone.addEventListener("pointercancel", finishResize, true);
  resizeZone.addEventListener("dragstart", (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, true);

  flipButton.addEventListener("click", flip);
  coinButton.addEventListener("click", flip);
  resetButton.addEventListener("click", reset);
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !event.repeat) {
      event.preventDefault();
      flip();
    }
  });

  render();
})();
