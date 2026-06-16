(() => {
  "use strict";

  const palettes = ["aurora", "sunset", "ocean", "mono"];
  const widget = document.querySelector(".widget");
  const dragHandle = document.querySelector("#dragHandle");
  const paletteButton = document.querySelector("#paletteButton");
  const resizeHandle = document.querySelector("#resizeHandle");
  const locationLabel = document.querySelector("#location");
  const temperatureValue = document.querySelector("#temperature");
  const condition = document.querySelector("#condition");
  const feelsLikeValue = document.querySelector("#feelsLike");
  const updated = document.querySelector("#updated");
  const detailValues = Array.from(document.querySelectorAll(".detail strong"));
  const forecastItems = Array.from(document.querySelectorAll(".forecast > div"));
  const minimumSize = { width: 260, height: 180 };
  const defaultWeatherLocation = {
    name: "Bengaluru",
    latitude: 12.9716,
    longitude: 77.5946
  };
  const layoutPreferences = {
    snap: true,
    autoAlign: true,
    snapDistance: 24,
    spacing: 20,
    align: ["edges", "horizontal-center", "vertical-center"]
  };
  const instanceId = globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const layoutStoragePrefix = "intelligent-widget-bounds:";
  const peerWindows = new Map();
  let layoutChannel = null;
  let dragState = null;
  let resizeState = null;
  let skyPhaseOverride = null;
  let hostWeatherOverrideUntil = 0;

  const savedPalette = localStorage.getItem("weather-widget-palette");
  let paletteIndex = Math.max(0, palettes.indexOf(savedPalette));
  widget.dataset.palette = palettes[paletteIndex];

  function setUpdatedTime() {
    const now = new Date();
    updated.textContent = now.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
    updateSkyPhase();
  }

  function classifyWeatherCode(code) {
    const value = Number(code);
    if ([95, 96, 99].includes(value)) {
      return "storm";
    }
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(value)) {
      return "rain";
    }
    if ([71, 73, 75, 77, 85, 86].includes(value)) {
      return "snow";
    }
    if (value === 0 || value === 1) {
      return "clear";
    }
    if (value === 2) {
      return "partly-cloudy";
    }
    return "cloudy";
  }

  function classifyWeather(value) {
    const description = String(value || "").toLowerCase();
    if (description.includes("after rain") ||
        description.includes("clearing") ||
        description.includes("recent rain")) {
      return "after-rain";
    }
    if (description.includes("storm") || description.includes("thunder")) {
      return "storm";
    }
    if (description.includes("rain") || description.includes("drizzle")) {
      return "rain";
    }
    if (description.includes("snow") || description.includes("sleet")) {
      return "snow";
    }
    if (description.includes("clear") || description.includes("sunny")) {
      return "clear";
    }
    if (description.includes("partly")) {
      return "partly-cloudy";
    }
    return "cloudy";
  }

  function updateWeatherArtifact(description, weatherCode) {
    widget.dataset.weather = Number.isFinite(Number(weatherCode))
      ? classifyWeatherCode(weatherCode)
      : classifyWeather(description);
  }

  function describeWeatherCode(code) {
    const descriptions = {
      0: "Clear",
      1: "Mainly clear",
      2: "Partly cloudy",
      3: "Cloudy",
      45: "Fog",
      48: "Rime fog",
      51: "Light drizzle",
      53: "Drizzle",
      55: "Heavy drizzle",
      56: "Freezing drizzle",
      57: "Freezing drizzle",
      61: "Light rain",
      63: "Rain",
      65: "Heavy rain",
      66: "Freezing rain",
      67: "Freezing rain",
      71: "Light snow",
      73: "Snow",
      75: "Heavy snow",
      77: "Snow grains",
      80: "Rain showers",
      81: "Rain showers",
      82: "Heavy showers",
      85: "Snow showers",
      86: "Heavy snow showers",
      95: "Thunderstorm",
      96: "Thunderstorm",
      99: "Thunderstorm"
    };
    return descriptions[Number(code)] || "Cloudy";
  }

  function iconClassForWeather(weather) {
    if (weather === "clear") return "sunny";
    if (weather === "partly-cloudy" || weather === "after-rain") return "partly";
    if (weather === "rain") return "rain";
    if (weather === "snow") return "snow";
    if (weather === "storm") return "storm";
    return "cloudy";
  }

  function rounded(value) {
    return Math.round(Number(value));
  }

  function normalizeLocation(location) {
    const latitude = Number(location?.latitude ?? location?.lat);
    const longitude = Number(location?.longitude ?? location?.lon ?? location?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    return {
      name: location.name ||
        location.city ||
        location.town ||
        location.locality ||
        location.region ||
        "Current location",
      latitude,
      longitude,
      savedAt: Date.now()
    };
  }

  function getSkyPhase(date = new Date()) {
    const hour = date.getHours();
    if (hour >= 5 && hour < 8) {
      return "dawn";
    }
    if (hour >= 8 && hour < 18) {
      return "day";
    }
    if (hour >= 18 && hour < 20) {
      return "dusk";
    }
    return "night";
  }

  function updateSkyPhase(phase) {
    const allowed = ["dawn", "day", "dusk", "night"];
    if (allowed.includes(phase)) {
      skyPhaseOverride = phase;
    }
    widget.dataset.sky = skyPhaseOverride || getSkyPhase();
  }

  function getHostProvidedLocation() {
    for (const bridge of [window.widgetHost, window.widgetAPI, window.electronAPI]) {
      try {
        const location = bridge?.getLocation?.() || bridge?.weatherLocation;
        const normalized = normalizeLocation(location);
        if (normalized) {
          return normalized;
        }
      } catch {
        // Continue through available host adapters.
      }
    }
    return null;
  }

  function requestHostLocation() {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (location) => {
        if (finished) {
          return;
        }
        finished = true;
        window.removeEventListener("message", handleMessage);
        window.removeEventListener("location:update", handleLocationEvent);
        window.removeEventListener("widget:location", handleLocationEvent);
        window.removeEventListener("weather:location", handleLocationEvent);
        resolve(normalizeLocation(location));
      };
      const handleLocationEvent = (event) => finish(event.detail);
      const handleMessage = (event) => {
        const data = event.data;
        if (data?.type === "widget:location" ||
            data?.type === "location:update" ||
            data?.type === "weather:location") {
          finish(data);
        }
      };

      window.addEventListener("message", handleMessage);
      window.addEventListener("location:update", handleLocationEvent);
      window.addEventListener("widget:location", handleLocationEvent);
      window.addEventListener("weather:location", handleLocationEvent);
      sendHostMessage("widget:location-request", { reason: "weather-sync" });
      window.setTimeout(() => finish(null), 1200);
    });
  }

  function getBrowserLocation() {
    if (!navigator.geolocation) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            name: "Current location",
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            savedAt: Date.now()
          });
        },
        () => resolve(null),
        {
          enableHighAccuracy: false,
          maximumAge: 10 * 60 * 1000,
          timeout: 4500
        }
      );
    });
  }

  async function getIpLocation() {
    const providers = [
      {
        url: "https://ipapi.co/json/",
        parse: (data) => normalizeLocation({
          city: data.city,
          region: data.region,
          latitude: data.latitude,
          longitude: data.longitude
        })
      },
      {
        url: "https://ipwho.is/",
        parse: (data) => data.success === false ? null : normalizeLocation({
          city: data.city,
          region: data.region,
          latitude: data.latitude,
          longitude: data.longitude
        })
      }
    ];

    for (const provider of providers) {
      try {
        const response = await fetch(provider.url, { cache: "no-store" });
        if (!response.ok) {
          continue;
        }
        const location = provider.parse(await response.json());
        if (location) {
          return location;
        }
      } catch {
        // Try the next location provider.
      }
    }
    return null;
  }

  async function resolveWeatherLocation() {
    const hostLocation = getHostProvidedLocation();
    if (hostLocation) {
      return hostLocation;
    }

    const requestedHostLocation = await requestHostLocation();
    if (requestedHostLocation) {
      return requestedHostLocation;
    }

    const browserLocation = await getBrowserLocation();
    if (browserLocation) {
      try {
        localStorage.setItem("weather-widget-location", JSON.stringify(browserLocation));
      } catch {
        // Ignore unavailable storage.
      }
      return browserLocation;
    }

    const ipLocation = await getIpLocation();
    if (ipLocation) {
      try {
        localStorage.setItem("weather-widget-location", JSON.stringify(ipLocation));
      } catch {
        // Ignore unavailable storage.
      }
      return ipLocation;
    }

    try {
      const saved = JSON.parse(localStorage.getItem("weather-widget-location") || "null");
      const savedLocation = normalizeLocation(saved);
      const savedAge = Date.now() - Number(saved?.savedAt || 0);
      if (savedLocation && savedAge < 2 * 60 * 60 * 1000) {
        return savedLocation;
      }
    } catch {
      // Fall back to browser/default location.
    }

    return defaultWeatherLocation;
  }

  function buildForecastUrl({ latitude, longitude }) {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: [
        "temperature_2m",
        "relative_humidity_2m",
        "apparent_temperature",
        "is_day",
        "precipitation",
        "weather_code",
        "wind_speed_10m"
      ].join(","),
      hourly: ["temperature_2m", "weather_code"].join(","),
      daily: ["temperature_2m_max", "temperature_2m_min"].join(","),
      timezone: "auto",
      forecast_days: "1"
    });
    return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  }

  function applyWeatherData(place, data) {
    const current = data.current || {};
    const daily = data.daily || {};
    const hourly = data.hourly || {};
    const weatherCode = current.weather_code;
    const weather = classifyWeatherCode(weatherCode);
    const conditionText = describeWeatherCode(weatherCode);

    locationLabel.textContent = place.name;
    temperatureValue.textContent = rounded(current.temperature_2m);
    feelsLikeValue.textContent = rounded(current.apparent_temperature);
    condition.textContent = conditionText;
    updateWeatherArtifact(conditionText, weatherCode);

    if (typeof current.is_day === "number") {
      updateSkyPhase(current.is_day === 1 ? "day" : "night");
    }

    if (detailValues[0]) {
      detailValues[0].innerHTML = `${rounded(current.wind_speed_10m)} <small>km/h</small>`;
    }
    if (detailValues[1]) {
      detailValues[1].innerHTML = `${rounded(current.relative_humidity_2m)}<small>%</small>`;
    }
    if (detailValues[2]) {
      detailValues[2].innerHTML =
        `${rounded(daily.temperature_2m_max?.[0])}° <small>/ ${rounded(daily.temperature_2m_min?.[0])}°</small>`;
    }

    const currentTime = current.time ? new Date(current.time) : new Date();
    const hourlyTimes = hourly.time || [];
    const hourlyTemps = hourly.temperature_2m || [];
    const hourlyCodes = hourly.weather_code || [];
    let startIndex = hourlyTimes.findIndex((time) => new Date(time) >= currentTime);
    if (startIndex < 0) {
      startIndex = 0;
    }

    forecastItems.forEach((item, index) => {
      const sourceIndex = Math.min(startIndex + index * 2, hourlyTimes.length - 1);
      const label = item.querySelector("span");
      const temp = item.querySelector("strong");
      const icon = item.querySelector("i");
      const time = hourlyTimes[sourceIndex] ? new Date(hourlyTimes[sourceIndex]) : currentTime;
      const code = hourlyCodes[sourceIndex] ?? weatherCode;
      const forecastWeather = classifyWeatherCode(code);
      if (label) {
        label.textContent = index === 0
          ? "Now"
          : time.toLocaleTimeString([], { hour: "numeric" });
      }
      if (temp) {
        temp.textContent = `${rounded(hourlyTemps[sourceIndex] ?? current.temperature_2m)}°`;
      }
      if (icon) {
        icon.className = `mini-icon ${iconClassForWeather(forecastWeather)}`;
      }
    });

    updated.textContent = new Date().toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  async function refreshLiveWeather() {
    if (Date.now() < hostWeatherOverrideUntil) {
      return;
    }

    const previousLocation = locationLabel.textContent;
    try {
      updated.textContent = "Updating";
      locationLabel.textContent = "Locating";
      const place = await resolveWeatherLocation();
      const response = await fetch(buildForecastUrl(place), { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Weather request failed: ${response.status}`);
      }
      applyWeatherData(place, await response.json());
    } catch {
      if (locationLabel.textContent === "Locating") {
        locationLabel.textContent = previousLocation || "Location";
      }
      updated.textContent = "Weather unavailable";
      updateWeatherArtifact(condition.textContent);
    }
  }

  function applyHostWeather(detail = {}) {
    const hasWeatherPayload = [
      "condition",
      "weatherCode",
      "temperature",
      "feelsLike",
      "wind",
      "humidity",
      "high",
      "low"
    ].some((key) => detail[key] !== undefined);
    if (!hasWeatherPayload && !detail.latitude && !detail.longitude) {
      return;
    }

    if (Number.isFinite(Number(detail.latitude)) && Number.isFinite(Number(detail.longitude))) {
      try {
        localStorage.setItem("weather-widget-location", JSON.stringify({
          name: detail.location || detail.city || "Current location",
          latitude: Number(detail.latitude),
          longitude: Number(detail.longitude),
          savedAt: Date.now()
        }));
      } catch {
        // Ignore unavailable storage.
      }
    }

    if (!hasWeatherPayload) {
      hostWeatherOverrideUntil = 0;
      refreshLiveWeather();
      return;
    }

    hostWeatherOverrideUntil = Date.now() + 15 * 60 * 1000;

    if (detail.location || detail.city) {
      locationLabel.textContent = detail.location || detail.city;
    }
    if (Number.isFinite(Number(detail.temperature))) {
      temperatureValue.textContent = rounded(detail.temperature);
    }
    if (Number.isFinite(Number(detail.feelsLike))) {
      feelsLikeValue.textContent = rounded(detail.feelsLike);
    }
    if (detail.condition || Number.isFinite(Number(detail.weatherCode))) {
      const nextCondition = detail.condition || describeWeatherCode(detail.weatherCode);
      condition.textContent = nextCondition;
      updateWeatherArtifact(nextCondition, detail.weatherCode);
    }
    if (Number.isFinite(Number(detail.wind)) && detailValues[0]) {
      detailValues[0].innerHTML = `${rounded(detail.wind)} <small>km/h</small>`;
    }
    if (Number.isFinite(Number(detail.humidity)) && detailValues[1]) {
      detailValues[1].innerHTML = `${rounded(detail.humidity)}<small>%</small>`;
    }
    if (Number.isFinite(Number(detail.high)) && Number.isFinite(Number(detail.low)) && detailValues[2]) {
      detailValues[2].innerHTML = `${rounded(detail.high)}° <small>/ ${rounded(detail.low)}°</small>`;
    }
  }

  function initSkyRenderer() {
    const canvas = document.querySelector("#skyCanvas");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stars = Array.from({ length: 46 }, (_, index) => {
      const xSeed = Math.sin((index + 1) * 91.417) * 43758.5453;
      const ySeed = Math.sin((index + 1) * 47.853) * 24634.6345;
      return {
        x: xSeed - Math.floor(xSeed),
        y: (ySeed - Math.floor(ySeed)) * 0.7,
        radius: 0.35 + ((index * 17) % 9) / 10,
        alpha: 0.2 + ((index * 13) % 7) / 10
      };
    });
    const particles = Array.from({ length: 44 }, (_, index) => ({
      x: ((index * 37) % 101) / 101,
      y: ((index * 61) % 97) / 97,
      speed: 0.42 + ((index * 11) % 13) / 16,
      size: 0.6 + ((index * 7) % 9) / 7
    }));
    const palettesByPhase = {
      dawn: ["#08090a", "#251719", "#4b1b19"],
      day: ["#151719", "#292c2f", "#4a4b4c"],
      dusk: ["#07080a", "#211416", "#461615"],
      night: ["#020304", "#080a0d", "#111318"]
    };

    let width = 0;
    let height = 0;
    let frameId = 0;
    let previousFrame = 0;

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw(performance.now());
    }

    function drawBaseSky(phase, weather) {
      const colors = palettesByPhase[phase] || palettesByPhase.day;
      const gradient = context.createLinearGradient(0, 0, width * 0.18, height);
      gradient.addColorStop(0, colors[0]);
      gradient.addColorStop(0.56, colors[1]);
      gradient.addColorStop(1, colors[2]);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const lightX = phase === "dawn" ? width * 0.2 : phase === "dusk" ? width * 0.82 : width * 0.7;
      const lightY = phase === "night" ? height * 0.16 : height * 0.58;
      const radius = Math.max(width, height) * 0.7;
      const light = context.createRadialGradient(lightX, lightY, 0, lightX, lightY, radius);
      light.addColorStop(0, phase === "day" ? "rgba(255,255,255,.16)" : "rgba(255,59,48,.18)");
      light.addColorStop(0.35, phase === "night" ? "rgba(255,255,255,.02)" : "rgba(255,59,48,.05)");
      light.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = light;
      context.fillRect(0, 0, width, height);

      if (weather === "rain" || weather === "storm") {
        const shade = context.createLinearGradient(0, 0, 0, height);
        shade.addColorStop(0, "rgba(0,0,0,.3)");
        shade.addColorStop(1, "rgba(0,0,0,.6)");
        context.fillStyle = shade;
        context.fillRect(0, 0, width, height);
      }
    }

    function drawStars(time, phase, weather) {
      if (phase !== "night" ||
          !["clear", "partly-cloudy", "after-rain"].includes(weather)) {
        return;
      }

      stars.forEach((star, index) => {
        const twinkle = reducedMotion ? 0.72 : 0.6 + Math.sin(time * 0.0012 + index * 2.1) * 0.2;
        context.beginPath();
        context.fillStyle = `rgba(255,255,255,${star.alpha * twinkle})`;
        context.arc(star.x * width, star.y * height, star.radius, 0, Math.PI * 2);
        context.fill();
      });
    }

    function drawCloud(x, y, scale, alpha, darkness) {
      context.save();
      context.translate(x, y);
      context.scale(scale, scale);
      context.filter = `blur(${Math.max(5, width * 0.014)}px)`;
      const gradient = context.createLinearGradient(0, -38, 0, 36);
      gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
      gradient.addColorStop(0.58, `rgba(148,151,154,${alpha * 0.66})`);
      gradient.addColorStop(1, `rgba(9,11,13,${darkness})`);
      context.fillStyle = gradient;

      [
        [-58, 5, 74, 29],
        [-17, -16, 79, 43],
        [39, -5, 90, 39],
        [77, 10, 65, 25]
      ].forEach(([xPosition, yPosition, xRadius, yRadius]) => {
        context.beginPath();
        context.ellipse(xPosition, yPosition, xRadius, yRadius, 0, 0, Math.PI * 2);
        context.fill();
      });
      context.restore();
    }

    function drawClouds(time, weather) {
      const hasClouds = [
        "partly-cloudy",
        "cloudy",
        "rain",
        "snow",
        "storm",
        "after-rain"
      ].includes(weather);
      if (!hasClouds) {
        return;
      }

      const drift = reducedMotion ? 0 : Math.sin(time * 0.00008) * width * 0.028;
      const dense = ["cloudy", "rain", "snow", "storm"].includes(weather);
      const alpha = weather === "storm" ? 0.28 : weather === "rain" ? 0.36 : 0.48;
      drawCloud(
        width * 0.76 + drift,
        height * 0.46,
        Math.max(0.52, width / 560),
        alpha,
        dense ? 0.72 : 0.42
      );

      if (dense) {
        drawCloud(
          width * 0.24 - drift * 0.7,
          height * 0.28,
          Math.max(0.46, width / 640),
          alpha * 0.72,
          0.66
        );
        drawCloud(
          width * 0.53 + drift * 0.4,
          height * 0.7,
          Math.max(0.54, width / 600),
          alpha * 0.46,
          0.62
        );
      }
    }

    function drawPrecipitation(time, weather) {
      if (!["rain", "storm", "snow"].includes(weather)) {
        return;
      }

      context.save();
      if (weather === "snow") {
        particles.slice(0, 30).forEach((particle, index) => {
          const y = ((particle.y * height + time * 0.012 * particle.speed) % (height + 12)) - 6;
          const x = particle.x * width + Math.sin(time * 0.001 + index) * 5;
          context.beginPath();
          context.fillStyle = `rgba(255,255,255,${0.18 + particle.speed * 0.24})`;
          context.arc(x, y, particle.size, 0, Math.PI * 2);
          context.fill();
        });
      } else {
        context.lineWidth = Math.max(0.6, width / 700);
        context.strokeStyle = weather === "storm"
          ? "rgba(255,255,255,.17)"
          : "rgba(220,225,229,.23)";
        particles.forEach((particle) => {
          const y = ((particle.y * height + time * 0.05 * particle.speed) % (height + 32)) - 16;
          const x = particle.x * width;
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x - 5, y + 16 + particle.speed * 8);
          context.stroke();
        });
      }
      context.restore();
    }

    function drawClearing(weather) {
      if (weather !== "after-rain") {
        return;
      }
      context.save();
      context.strokeStyle = "rgba(255,59,48,.12)";
      context.lineWidth = Math.max(1, width * 0.004);
      context.beginPath();
      context.arc(width * 0.72, height * 0.88, width * 0.26, Math.PI * 1.08, Math.PI * 1.86);
      context.stroke();
      context.restore();
    }

    function draw(time = 0) {
      if (!width || !height) {
        return;
      }
      const phase = widget.dataset.sky || "day";
      const weather = widget.dataset.weather || "partly-cloudy";
      context.clearRect(0, 0, width, height);
      drawBaseSky(phase, weather);
      drawStars(time, phase, weather);
      drawClouds(time, weather);
      drawPrecipitation(time, weather);
      drawClearing(weather);
    }

    function render(time) {
      if (!reducedMotion && time - previousFrame >= 33) {
        draw(time);
        previousFrame = time;
      }
      frameId = window.requestAnimationFrame(render);
    }

    const resizeObserver = new ResizeObserver(resize);
    const stateObserver = new MutationObserver(() => draw(performance.now()));
    resizeObserver.observe(widget);
    stateObserver.observe(widget, {
      attributes: true,
      attributeFilter: ["data-weather", "data-sky"]
    });
    resize();
    frameId = window.requestAnimationFrame(render);

    window.addEventListener("beforeunload", () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      stateObserver.disconnect();
    });
  }

  async function initWebGLArtifact() {
    const canvas = document.querySelector("#weatherCanvas");
    const mark = canvas?.closest(".weather-mark");
    if (!canvas || !mark) {
      return;
    }

    let THREE;
    try {
      THREE = await import("https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.min.js");
    } catch {
      mark.classList.add("webgl-unavailable");
      return;
    }

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance"
      });
    } catch {
      mark.classList.add("webgl-unavailable");
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 30);
    camera.position.set(0, 0.04, 4.65);

    const artifact = new THREE.Group();
    artifact.rotation.set(-0.06, -0.18, -0.035);
    scene.add(artifact);

    const ambientLight = new THREE.HemisphereLight(0xe7e8e5, 0x1b1c1e, 1.25);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 4.4);
    keyLight.position.set(-4, 5, 5);
    scene.add(keyLight);

    const redLight = new THREE.PointLight(0xff3b30, 1.4, 5, 2);
    redLight.position.set(2.3, 1.1, 2.8);
    scene.add(redLight);

    const rimLight = new THREE.PointLight(0xd8dcdf, 2.4, 7, 2);
    rimLight.position.set(-3.1, -0.8, 2.8);
    scene.add(rimLight);

    const cloudMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xb7b8b5,
      roughness: 0.48,
      metalness: 0.42,
      clearcoat: 0.12,
      clearcoatRoughness: 0.64
    });
    const cloudUndersideMaterial = new THREE.MeshStandardMaterial({
      color: 0x303335,
      roughness: 0.58,
      metalness: 0.56
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0xff3b30,
      emissive: 0x3c0201,
      emissiveIntensity: 0.07,
      roughness: 0.68,
      metalness: 0.16
    });
    const weatherDetailMaterial = new THREE.MeshStandardMaterial({
      color: 0xc7c8c5,
      roughness: 0.72,
      metalness: 0.14
    });
    const darkDetailMaterial = new THREE.MeshStandardMaterial({
      color: 0x242729,
      roughness: 0.84,
      metalness: 0.12
    });

    function polygonShape(points) {
      const shape = new THREE.Shape();
      shape.moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach(([x, y]) => shape.lineTo(x, y));
      shape.closePath();
      return shape;
    }

    const boltShape = polygonShape([
      [0.26, 1.48],
      [-0.76, 0.25],
      [-0.18, 0.25],
      [-0.48, -1.48],
      [0.86, -0.08],
      [0.26, -0.08]
    ]);

    const cloudShape = new THREE.Shape();
    cloudShape.moveTo(-1.44, -0.42);
    cloudShape.lineTo(1.23, -0.42);
    cloudShape.bezierCurveTo(1.52, -0.42, 1.6, -0.08, 1.4, 0.11);
    cloudShape.bezierCurveTo(1.28, 0.26, 1.12, 0.29, 0.94, 0.27);
    cloudShape.bezierCurveTo(0.87, 0.66, 0.49, 0.85, 0.13, 0.61);
    cloudShape.bezierCurveTo(-0.19, 1.02, -0.85, 0.8, -0.94, 0.27);
    cloudShape.bezierCurveTo(-1.29, 0.3, -1.55, 0.08, -1.55, -0.17);
    cloudShape.bezierCurveTo(-1.55, -0.28, -1.51, -0.36, -1.44, -0.42);
    cloudShape.closePath();

    function extrudedMesh(shape, materials, depth = 0.3, bevel = 0.045) {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelSegments: 5,
        bevelSize: bevel,
        bevelThickness: bevel * 1.2,
        curveSegments: 24
      });
      geometry.center();
      return new THREE.Mesh(geometry, materials);
    }

    function createSun(scale = 1) {
      const group = new THREE.Group();
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.82, 48, 32),
        accentMaterial
      );
      group.add(sphere);
      group.scale.setScalar(scale);
      return group;
    }

    function createCloud(scale = 1) {
      const group = new THREE.Group();
      const body = extrudedMesh(
        cloudShape,
        [cloudMaterial, cloudUndersideMaterial],
        0.52,
        0.07
      );
      body.scale.z = 0.92;
      group.add(body);
      group.scale.setScalar(scale);
      return group;
    }

    function createRain() {
      const group = new THREE.Group();
      const cloud = createCloud(0.78);
      cloud.position.y = 0.26;
      group.add(cloud);
      [-0.52, 0, 0.52].forEach((x, index) => {
        const rain = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.055, index === 1 ? 0.54 : 0.42, 6, 12),
          index === 1 ? accentMaterial : weatherDetailMaterial
        );
        rain.position.set(x, -0.7, index === 1 ? 0.12 : 0);
        rain.rotation.z = -0.3;
        group.add(rain);
      });
      group.scale.setScalar(0.9);
      return group;
    }

    function createSnow() {
      const group = new THREE.Group();
      const cloud = createCloud(0.78);
      cloud.position.y = 0.28;
      group.add(cloud);
      [-0.48, 0, 0.48].forEach((x, index) => {
        const crystal = new THREE.Mesh(
          new THREE.OctahedronGeometry(index === 1 ? 0.16 : 0.12, 0),
          index === 1 ? accentMaterial : weatherDetailMaterial
        );
        crystal.position.set(x, -0.67 - Math.abs(index - 1) * 0.08, index === 1 ? 0.12 : 0);
        crystal.rotation.z = Math.PI / 4;
        group.add(crystal);
      });
      group.scale.setScalar(0.92);
      return group;
    }

    function createStorm() {
      const group = new THREE.Group();
      const cloud = createCloud(0.8);
      cloud.position.y = 0.27;
      group.add(cloud);
      const bolt = extrudedMesh(
        boltShape,
        [accentMaterial, darkDetailMaterial],
        0.26
      );
      bolt.position.set(0.08, -0.72, 0.18);
      bolt.scale.setScalar(0.46);
      group.add(bolt);
      group.scale.setScalar(0.94);
      return group;
    }

    const symbols = {
      clear: createSun(0.94),
      cloudy: createCloud(0.9),
      rain: createRain(),
      snow: createSnow(),
      storm: createStorm()
    };

    const partlyCloudy = new THREE.Group();
    const partlySun = createSun(0.72);
    partlySun.position.set(0.48, 0.42, -0.3);
    partlyCloudy.add(partlySun);
    const partlyCloud = createCloud(0.72);
    partlyCloud.position.set(-0.12, -0.2, 0.18);
    partlyCloudy.add(partlyCloud);
    partlyCloudy.scale.setScalar(0.92);
    symbols["partly-cloudy"] = partlyCloudy;

    Object.values(symbols).forEach((symbol) => {
      symbol.rotation.set(-0.025, 0.22, -0.045);
      artifact.add(symbol);
    });

    let activeSymbol = symbols["partly-cloudy"];

    function syncCondition() {
      const weather = widget.dataset.weather;
      Object.values(symbols).forEach((symbol) => {
        symbol.visible = false;
      });
      activeSymbol = weather === "after-rain"
        ? symbols["partly-cloudy"]
        : symbols[weather] || symbols.cloudy;
      activeSymbol.visible = true;
      const phase = widget.dataset.sky || "day";
      const night = phase === "night";
      const transitional = phase === "dawn" || phase === "dusk";
      keyLight.color.setHex(night ? 0xb8c0c7 : 0xffffff);
      keyLight.intensity = night ? 3.6 : transitional ? 4 : 4.4;
      ambientLight.intensity = night ? 1 : transitional ? 1.12 : 1.25;
      rimLight.intensity = night ? 2.8 : transitional ? 2.6 : 2.4;
      redLight.intensity = weather === "storm" ? 2.4 : transitional ? 1.8 : 1.4;
      renderer.toneMappingExposure = night ? 0.94 : 0.96;
    }

    const conditionObserver = new MutationObserver(syncCondition);
    conditionObserver.observe(widget, {
      attributes: true,
      attributeFilter: ["data-weather", "data-sky"]
    });
    syncCondition();

    function resizeRenderer() {
      const rect = mark.getBoundingClientRect();
      const size = Math.max(64, rect.width * 1.36);
      renderer.setSize(size, size, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    }

    const resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(mark);
    resizeRenderer();

    const pointerTarget = { x: 0, y: 0 };
    widget.addEventListener("pointermove", (event) => {
      const rect = widget.getBoundingClientRect();
      pointerTarget.x = ((event.clientX - rect.left) / rect.width - 0.5) * 0.26;
      pointerTarget.y = ((event.clientY - rect.top) / rect.height - 0.5) * 0.18;
    });
    widget.addEventListener("pointerleave", () => {
      pointerTarget.x = 0;
      pointerTarget.y = 0;
    });

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clock = new THREE.Clock();
    let frameId = 0;
    let visible = !document.hidden;

    function render() {
      if (!visible) {
        return;
      }

      const elapsed = clock.getElapsedTime();
      artifact.rotation.y += (pointerTarget.x - artifact.rotation.y) * 0.045;
      artifact.rotation.x += (-0.06 - pointerTarget.y - artifact.rotation.x) * 0.045;

      if (!reducedMotion) {
        artifact.position.y = Math.sin(elapsed * 0.36) * 0.008;
        activeSymbol.rotation.y = 0.22 + Math.sin(elapsed * 0.28) * 0.018;
      }

      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(render);
    }

    document.addEventListener("visibilitychange", () => {
      visible = !document.hidden;
      if (visible) {
        clock.start();
        window.cancelAnimationFrame(frameId);
        render();
      }
    });

    renderer.render(scene, camera);
    mark.classList.add("webgl-ready");
    render();

    window.addEventListener("beforeunload", () => {
      window.cancelAnimationFrame(frameId);
      conditionObserver.disconnect();
      resizeObserver.disconnect();
      renderer.dispose();
      scene.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material.dispose());
        } else {
          object.material?.dispose?.();
        }
      });
    });
  }

  function cyclePalette() {
    paletteIndex = (paletteIndex + 1) % palettes.length;
    const palette = palettes[paletteIndex];
    widget.dataset.palette = palette;
    localStorage.setItem("weather-widget-palette", palette);
    paletteButton.setAttribute("aria-label", `Color palette: ${palette}. Change palette`);
  }

  function sendHostMessage(type, detail) {
    const message = { type, ...detail };
    window.dispatchEvent(new CustomEvent(type, { detail }));

    if (window.parent !== window) {
      window.parent.postMessage(message, "*");
    }

    if (window.chrome?.webview) {
      window.chrome.webview.postMessage(message);
    }
  }

  function requestWindowResize(width, height) {
    const nextWidth = Math.max(minimumSize.width, Math.round(width));
    const nextHeight = Math.max(minimumSize.height, Math.round(height));
    const detail = { width: nextWidth, height: nextHeight, edge: "se" };

    sendHostMessage("widget:resize", detail);

    try {
      window.resizeTo(nextWidth, nextHeight);
    } catch {
      // The desktop host can handle the resize event when direct resizing is restricted.
    }
  }

  function beginResize(event) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    resizeState = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      width: window.outerWidth || document.documentElement.clientWidth,
      height: window.outerHeight || document.documentElement.clientHeight
    };
    resizeHandle.setPointerCapture(event.pointerId);
    resizeHandle.classList.add("is-resizing");
  }

  function continueResize(event) {
    if (!resizeState || event.pointerId !== resizeState.pointerId) {
      return;
    }

    requestWindowResize(
      resizeState.width + event.screenX - resizeState.startX,
      resizeState.height + event.screenY - resizeState.startY
    );
  }

  function endResize(event) {
    if (!resizeState || event.pointerId !== resizeState.pointerId) {
      return;
    }

    if (resizeHandle.hasPointerCapture(event.pointerId)) {
      resizeHandle.releasePointerCapture(event.pointerId);
    }
    resizeHandle.classList.remove("is-resizing");
    resizeState = null;
  }

  function getWindowBounds() {
    return {
      id: instanceId,
      x: window.screenX,
      y: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
      seenAt: Date.now()
    };
  }

  function nearestSnap(value, candidates) {
    return candidates.reduce((nearest, candidate) => {
      const distance = Math.abs(candidate - value);
      return distance <= layoutPreferences.snapDistance &&
        (nearest === null || distance < Math.abs(nearest - value))
        ? candidate
        : nearest;
    }, null);
  }

  function getSnapPosition(bounds) {
    const now = Date.now();
    const xCandidates = [];
    const yCandidates = [];

    peerWindows.forEach((peer, id) => {
      if (now - peer.seenAt > 1500) {
        peerWindows.delete(id);
        return;
      }

      xCandidates.push(
        peer.x,
        peer.x + peer.width - bounds.width,
        peer.x + (peer.width - bounds.width) / 2,
        peer.x + peer.width + layoutPreferences.spacing,
        peer.x - bounds.width - layoutPreferences.spacing
      );
      yCandidates.push(
        peer.y,
        peer.y + peer.height - bounds.height,
        peer.y + (peer.height - bounds.height) / 2,
        peer.y + peer.height + layoutPreferences.spacing,
        peer.y - bounds.height - layoutPreferences.spacing
      );
    });

    const snappedX = nearestSnap(bounds.x, xCandidates);
    const snappedY = nearestSnap(bounds.y, yCandidates);
    return {
      x: Math.round(snappedX ?? bounds.x),
      y: Math.round(snappedY ?? bounds.y),
      snapped: snappedX !== null || snappedY !== null
    };
  }

  function moveWindow(x, y, snapped) {
    const detail = { x, y, snapped, reason: snapped ? "nearby-widget" : "drag" };
    sendHostMessage("widget:move", detail);

    for (const bridge of [window.widgetHost, window.widgetAPI, window.electronAPI]) {
      try {
        bridge?.moveWindow?.(x, y);
        bridge?.setWindowPosition?.(x, y);
      } catch {
        // Continue through the available movement adapters.
      }
    }

    try {
      window.moveTo(x, y);
    } catch {
      // The desktop host can apply widget:move when direct movement is restricted.
    }
  }

  function beginDrag(event) {
    if (event.button !== 0 || event.target.closest("button")) {
      return;
    }

    event.preventDefault();
    const bounds = getWindowBounds();
    dragState = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    };
    dragHandle.setPointerCapture(event.pointerId);
    dragHandle.classList.add("is-dragging");
    sendHostMessage("widget:drag-start", bounds);
  }

  function continueDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const target = getSnapPosition({
      x: dragState.x + event.screenX - dragState.startX,
      y: dragState.y + event.screenY - dragState.startY,
      width: dragState.width,
      height: dragState.height
    });
    widget.classList.toggle("is-snapping", target.snapped);
    moveWindow(target.x, target.y, target.snapped);
  }

  function endDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    if (dragHandle.hasPointerCapture(event.pointerId)) {
      dragHandle.releasePointerCapture(event.pointerId);
    }
    const bounds = getWindowBounds();
    dragHandle.classList.remove("is-dragging");
    widget.classList.remove("is-snapping");
    sendHostMessage("widget:drag-end", bounds);
    dragState = null;
  }

  function layoutTick() {
    const bounds = getWindowBounds();
    const now = Date.now();

    try {
      localStorage.setItem(`${layoutStoragePrefix}${instanceId}`, JSON.stringify(bounds));
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(layoutStoragePrefix) ||
            key === `${layoutStoragePrefix}${instanceId}`) {
          continue;
        }

        const peer = JSON.parse(localStorage.getItem(key));
        if (peer?.id) {
          peerWindows.set(peer.id, peer);
        }
      }
    } catch {
      // BroadcastChannel and host-managed snapping remain available.
    }

    peerWindows.forEach((peer, id) => {
      if (now - peer.seenAt > 1500) {
        peerWindows.delete(id);
        try {
          localStorage.removeItem(`${layoutStoragePrefix}${id}`);
        } catch {
          // Ignore unavailable storage cleanup.
        }
      }
    });
    layoutChannel?.postMessage(bounds);
  }

  try {
    layoutChannel = new BroadcastChannel("intelligent-widgets-layout");
    layoutChannel.addEventListener("message", ({ data }) => {
      if (data?.id && data.id !== instanceId) {
        peerWindows.set(data.id, data);
      }
    });
    window.setInterval(layoutTick, 100);
    window.addEventListener("beforeunload", () => layoutChannel.close());
  } catch {
    // Host-level snapping remains available when cross-window channels are unavailable.
  }

  window.addEventListener("beforeunload", () => {
    try {
      localStorage.removeItem(`${layoutStoragePrefix}${instanceId}`);
    } catch {
      // Ignore unavailable storage cleanup.
    }
  });

  paletteButton.addEventListener("click", cyclePalette);
  window.addEventListener("weather:update", (event) => {
    applyHostWeather(event.detail || {});
    if (event.detail?.phase) {
      updateSkyPhase(event.detail.phase);
    } else if (typeof event.detail?.isDay === "boolean") {
      updateSkyPhase(event.detail.isDay ? "day" : "night");
    }
  });
  dragHandle.addEventListener("pointerdown", beginDrag);
  dragHandle.addEventListener("pointermove", continueDrag);
  dragHandle.addEventListener("pointerup", endDrag);
  dragHandle.addEventListener("pointercancel", endDrag);
  resizeHandle.addEventListener("pointerdown", beginResize);
  resizeHandle.addEventListener("pointermove", continueResize);
  resizeHandle.addEventListener("pointerup", endResize);
  resizeHandle.addEventListener("pointercancel", endResize);
  sendHostMessage("widget:layout-preferences", layoutPreferences);
  updateWeatherArtifact(condition.textContent);
  updateSkyPhase();
  initSkyRenderer();
  initWebGLArtifact();
  setUpdatedTime();
  refreshLiveWeather();
  window.setInterval(setUpdatedTime, 60_000);
  window.setInterval(refreshLiveWeather, 10 * 60_000);
})();
