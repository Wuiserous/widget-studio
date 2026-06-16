(() => {
  "use strict";

  const widget = document.querySelector(".widget");
  const chargeValue = document.querySelector("#chargeValue");
  const stateText = document.querySelector("#stateText");
  const detailText = document.querySelector("#detailText");
  const artifactCanvas = document.querySelector("#artifactCanvas");

  let battery = null;
  let lastCharging = null;
  let transitionTimer = 0;
  let windowsPollActive = false;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  function polygonArea(points) {
    return points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2;
  }

  function triangulate(points) {
    const indices = points.map((_, index) => index);
    const triangles = [];
    const cross = (a, b, c) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (point, a, b, c) => {
      const ab = cross(a, b, point);
      const bc = cross(b, c, point);
      const ca = cross(c, a, point);
      return ab >= -1e-6 && bc >= -1e-6 && ca >= -1e-6;
    };

    let guard = 0;
    while (indices.length > 3 && guard < 100) {
      let clipped = false;
      for (let i = 0; i < indices.length; i += 1) {
        const previous = indices[(i - 1 + indices.length) % indices.length];
        const current = indices[i];
        const next = indices[(i + 1) % indices.length];
        if (cross(points[previous], points[current], points[next]) <= 1e-6) continue;

        const containsPoint = indices.some((candidate) => {
          if (candidate === previous || candidate === current || candidate === next) return false;
          return inside(points[candidate], points[previous], points[current], points[next]);
        });
        if (containsPoint) continue;

        triangles.push(previous, current, next);
        indices.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) break;
      guard += 1;
    }

    if (indices.length === 3) triangles.push(indices[0], indices[1], indices[2]);
    return triangles;
  }

  function buildBoltMesh() {
    let points = [
      [0.08, 1.28],
      [-0.72, 0.1],
      [-0.2, 0.1],
      [-0.5, -1.25],
      [0.8, 0.22],
      [0.23, 0.22],
      [0.52, 0.94]
    ];
    if (polygonArea(points) < 0) points = points.reverse();

    const depth = 0.58;
    const bevel = 0.11;
    const inset = points.map(([x, y]) => [x * 0.86, y * 0.86]);
    const frontZ = depth / 2;
    const frontShoulderZ = frontZ - bevel;
    const backZ = -depth / 2;
    const backShoulderZ = backZ + bevel;
    const positions = [];
    const normals = [];
    const pushVertex = (point, z, normal) => {
      positions.push(point[0], point[1], z);
      normals.push(normal[0], normal[1], normal[2]);
    };
    const pushTriangle = (a, az, b, bz, c, cz, normal) => {
      pushVertex(a, az, normal);
      pushVertex(b, bz, normal);
      pushVertex(c, cz, normal);
    };

    const triangles = triangulate(inset);
    for (let i = 0; i < triangles.length; i += 3) {
      const a = inset[triangles[i]];
      const b = inset[triangles[i + 1]];
      const c = inset[triangles[i + 2]];
      pushTriangle(a, frontZ, b, frontZ, c, frontZ, [0, 0, 1]);
      pushTriangle(c, backZ, b, backZ, a, backZ, [0, 0, -1]);
    }

    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      const insetPoint = inset[index];
      const insetNext = inset[(index + 1) % inset.length];
      const dx = next[0] - point[0];
      const dy = next[1] - point[1];
      const length = Math.hypot(dx, dy) || 1;
      const sideNormal = [dy / length, -dx / length, 0];
      const frontBevelNormal = [sideNormal[0] * 0.62, sideNormal[1] * 0.62, 0.78];
      const backBevelNormal = [sideNormal[0] * 0.62, sideNormal[1] * 0.62, -0.78];

      pushTriangle(insetPoint, frontZ, point, frontShoulderZ, next, frontShoulderZ, frontBevelNormal);
      pushTriangle(insetPoint, frontZ, next, frontShoulderZ, insetNext, frontZ, frontBevelNormal);
      pushTriangle(point, frontShoulderZ, point, backShoulderZ, next, backShoulderZ, sideNormal);
      pushTriangle(point, frontShoulderZ, next, backShoulderZ, next, frontShoulderZ, sideNormal);
      pushTriangle(point, backShoulderZ, insetPoint, backZ, insetNext, backZ, backBevelNormal);
      pushTriangle(point, backShoulderZ, insetNext, backZ, next, backShoulderZ, backBevelNormal);
    });

    return { positions, normals };
  }

  function perspectiveMatrix(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const range = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * range, -1,
      0, 0, near * far * 2 * range, 0
    ]);
  }

  function createArtifactRenderer(canvas) {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true
    });
    if (!gl) return null;

    const program = createProgram(gl, `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      uniform mat4 uProjection;
      uniform float uRotX;
      uniform float uRotY;
      uniform float uRotZ;
      uniform float uFloatY;
      uniform float uScale;
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vLocal;

      vec3 rotateX(vec3 p, float a) {
        float s = sin(a), c = cos(a);
        return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
      }
      vec3 rotateY(vec3 p, float a) {
        float s = sin(a), c = cos(a);
        return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
      }
      vec3 rotateZ(vec3 p, float a) {
        float s = sin(a), c = cos(a);
        return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
      }

      void main() {
        vec3 position = aPosition * uScale;
        vec3 normal = aNormal;
        position = rotateZ(rotateY(rotateX(position, uRotX), uRotY), uRotZ);
        normal = rotateZ(rotateY(rotateX(normal, uRotX), uRotY), uRotZ);
        position.y += uFloatY;
        position.z -= 4.7;
        vNormal = normalize(normal);
        vPosition = position;
        vLocal = aPosition;
        gl_Position = uProjection * vec4(position, 1.0);
      }
    `, `
      precision mediump float;
      uniform vec3 uBaseColor;
      uniform vec3 uAccentColor;
      uniform float uAccentStrength;
      uniform float uBrightness;
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vLocal;

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 keyLight = normalize(vec3(-0.62, 0.8, 0.72));
        vec3 rimLight = normalize(vec3(0.92, -0.25, 0.45));
        vec3 viewDir = normalize(-vPosition);
        float diffuse = max(dot(normal, keyLight), 0.0);
        float redFill = max(dot(normal, rimLight), 0.0);
        float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.1);
        vec3 reflected = reflect(-keyLight, normal);
        float specular = pow(max(dot(reflected, viewDir), 0.0), 42.0);
        float frontness = pow(abs(normal.z), 5.0);
        float diagonalA = smoothstep(-0.12, 0.12, vLocal.x + vLocal.y * 0.32);
        float diagonalB = smoothstep(-0.16, 0.16, vLocal.x - vLocal.y * 0.46);
        float facetLight = mix(0.62, 1.25, diagonalA) * mix(0.82, 1.08, diagonalB);
        float material = mix(0.66, facetLight, frontness);
        vec3 color = uBaseColor * material * (0.13 + diffuse * 0.88);
        color += vec3(1.0) * specular * 1.15;
        color += vec3(0.72, 0.77, 0.74) * rim * 0.2;
        color += uAccentColor * (redFill * 0.18 + rim * 0.48) * uAccentStrength;
        gl_FragColor = vec4(color * uBrightness, 1.0);
      }
    `);
    if (!program) return null;

    const mesh = buildBoltMesh();
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.positions), gl.STATIC_DRAW);
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.normals), gl.STATIC_DRAW);

    const locations = {
      position: gl.getAttribLocation(program, "aPosition"),
      normal: gl.getAttribLocation(program, "aNormal"),
      projection: gl.getUniformLocation(program, "uProjection"),
      rotX: gl.getUniformLocation(program, "uRotX"),
      rotY: gl.getUniformLocation(program, "uRotY"),
      rotZ: gl.getUniformLocation(program, "uRotZ"),
      floatY: gl.getUniformLocation(program, "uFloatY"),
      scale: gl.getUniformLocation(program, "uScale"),
      baseColor: gl.getUniformLocation(program, "uBaseColor"),
      accentColor: gl.getUniformLocation(program, "uAccentColor"),
      accentStrength: gl.getUniformLocation(program, "uAccentStrength"),
      brightness: gl.getUniformLocation(program, "uBrightness")
    };

    let state = "charging";
    let charging = true;
    let previousCharging = true;
    let transitionStarted = 0;

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      return width / height;
    }

    function draw(time) {
      const aspect = resize();
      const movement = charging ? 1 : 0;
      const pulse = state === "low" ? 0.78 + Math.sin(time * 0.006) * 0.22 : 1;
      const transitionAge = Math.min(1, (time - transitionStarted) / 700);
      const transitionLift = previousCharging !== charging
        ? Math.sin(transitionAge * Math.PI) * (charging ? 0.075 : -0.045)
        : 0;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(program);

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(locations.position);
      gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.enableVertexAttribArray(locations.normal);
      gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);

      gl.uniformMatrix4fv(locations.projection, false, perspectiveMatrix(0.66, aspect, 0.1, 20));
      gl.uniform1f(locations.rotX, 0.14 + Math.sin(time * 0.00075) * 0.055 * movement);
      gl.uniform1f(locations.rotY, -0.48 + Math.sin(time * 0.00062) * 0.16 * movement);
      gl.uniform1f(locations.rotZ, -0.045 + Math.sin(time * 0.0005) * 0.035 * movement);
      gl.uniform1f(locations.floatY, -0.14 + Math.sin(time * 0.002) * 0.04 * movement + transitionLift);
      gl.uniform1f(locations.scale, 1.24 + transitionLift * 0.2);

      const low = state === "low";
      gl.uniform3f(locations.baseColor, low ? 0.62 : 0.48, low ? 0.045 : 0.51, low ? 0.035 : 0.49);
      gl.uniform3f(locations.accentColor, 1.0, 0.11, 0.08);
      gl.uniform1f(locations.accentStrength, low ? 1.45 : charging ? 0.72 : 0.16);
      gl.uniform1f(locations.brightness, (state === "full" ? 1.06 : charging ? 1 : 0.66) * pulse);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.positions.length / 3);

      if (transitionAge >= 1) previousCharging = charging;
      window.requestAnimationFrame(draw);
    }

    window.requestAnimationFrame(draw);
    return {
      setState(nextState, nextCharging) {
        if (charging !== nextCharging) {
          previousCharging = charging;
          transitionStarted = performance.now();
        }
        state = nextState;
        charging = nextCharging;
      }
    };
  }

  const artifactRenderer = createArtifactRenderer(artifactCanvas);
  if (!artifactRenderer) widget.classList.add("webgl-unavailable");

  function normalize(payload) {
    if (!payload || typeof payload !== "object") return null;

    const rawLevel = payload.level ?? payload.percentage ?? payload.percent ?? payload.charge;
    const rawCharging = payload.charging ?? payload.isCharging ?? payload.pluggedIn ?? payload.onAC;
    if (rawLevel == null || rawCharging == null) return null;

    const numericLevel = Number(rawLevel);
    if (!Number.isFinite(numericLevel)) return null;

    const charging = typeof rawCharging === "string"
      ? /^(true|1|yes|online|charging)$/i.test(rawCharging)
      : Boolean(rawCharging);

    return {
      level: Math.max(0, Math.min(1, numericLevel > 1 ? numericLevel / 100 : numericLevel)),
      charging,
      chargingTime: Number(payload.chargingTime ?? payload.timeToFull ?? Infinity)
    };
  }

  function stateFor(level, charging) {
    if (level >= 0.995) return "full";
    if (level <= 0.2) return "low";
    return charging ? "charging" : "unplugged";
  }

  function formatTime(seconds, level) {
    const minutes = Number.isFinite(seconds) && seconds > 0
      ? Math.ceil(seconds / 60)
      : Math.max(1, Math.ceil((1 - level) * 180));

    if (minutes >= 60) {
      return `${Math.floor(minutes / 60)}H ${String(minutes % 60).padStart(2, "0")}M TO FULL`;
    }
    return `${minutes} MIN TO FULL`;
  }

  function playConnectionTransition(charging) {
    widget.classList.remove("just-connected", "just-disconnected");
    void widget.offsetWidth;
    widget.classList.add(charging ? "just-connected" : "just-disconnected");
    window.clearTimeout(transitionTimer);
    transitionTimer = window.setTimeout(() => {
      widget.classList.remove("just-connected", "just-disconnected");
    }, 950);
  }

  function render(reading) {
    const level = Math.max(0, Math.min(1, Number(reading.level)));
    const charging = Boolean(reading.charging);
    const percent = Math.round(level * 100);
    const state = stateFor(level, charging);

    if (lastCharging !== null && lastCharging !== charging) {
      playConnectionTransition(charging);
    }
    lastCharging = charging;

    widget.dataset.state = state;
    widget.dataset.charging = charging ? "true" : "false";
    widget.style.setProperty("--level", `${Math.max(2, percent)}%`);
    widget.style.setProperty("--glow-size", `${58 + percent * 0.18}%`);
    widget.style.setProperty("--glow-strength", String(0.68 + level * 0.25));
    widget.setAttribute("aria-label", `Battery at ${percent} percent, ${state}`);
    artifactRenderer?.setState(state, charging);
    chargeValue.textContent = String(percent);

    const labels = {
      charging: "CHARGING",
      unplugged: "ON BATTERY",
      low: charging ? "LOW / CHARGING" : "LOW POWER",
      full: "FULL"
    };
    stateText.textContent = labels[state];

    if (state === "full") {
      detailText.textContent = "CHARGE COMPLETE";
    } else if (charging) {
      detailText.textContent = formatTime(reading.chargingTime, level);
    } else {
      detailText.textContent = "POWER DISCONNECTED";
    }
  }

  function acceptPayload(payload) {
    const reading = normalize(payload?.battery ?? payload?.detail ?? payload);
    if (reading) render(reading);
  }

  function connectHost() {
    [
      "batterychange",
      "battery-status",
      "battery-update",
      "power-source-changed",
      "widget:battery"
    ].forEach((eventName) => {
      window.addEventListener(eventName, (event) => acceptPayload(event));
    });

    window.addEventListener("message", (event) => {
      const type = event.data?.type ?? event.data?.event;
      if (typeof type === "string" && /battery|power|charging/i.test(type)) {
        acceptPayload(event.data);
      }
    });

    const api = window.widgetAPI ?? window.intelligentWidgets ?? window.electronAPI;
    if (!api) return;

    ["getBattery", "getBatteryStatus", "batteryStatus"].some((method) => {
      if (typeof api[method] !== "function") return false;
      Promise.resolve(api[method]()).then(acceptPayload).catch(() => {});
      return true;
    });

    ["onBatteryChange", "onBatteryStatus", "onPowerChange"].forEach((method) => {
      if (typeof api[method] === "function") api[method](acceptPayload);
    });
  }

  async function connectBatteryApi() {
    if (typeof navigator.getBattery !== "function") return;

    try {
      battery = await navigator.getBattery();
      const read = () => render({
        level: battery.level,
        charging: battery.charging,
        chargingTime: battery.chargingTime
      });

      ["chargingchange", "levelchange", "chargingtimechange"].forEach((eventName) => {
        battery.addEventListener(eventName, read);
      });
      read();
      window.setInterval(read, 1500);
    } catch {
      battery = null;
    }
  }

  function connectWindowsPower() {
    let execFile;
    try {
      if (typeof window.require !== "function") return;
      execFile = window.require("child_process").execFile;
    } catch {
      return;
    }

    const command = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$p=[System.Windows.Forms.SystemInformation]::PowerStatus",
      "@{level=$p.BatteryLifePercent;charging=($p.PowerLineStatus -eq 'Online')} | ConvertTo-Json -Compress"
    ].join("; ");

    const poll = () => {
      if (windowsPollActive) return;
      windowsPollActive = true;
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { windowsHide: true, timeout: 2500 },
        (error, stdout) => {
          windowsPollActive = false;
          if (error || !stdout) return;
          try {
            acceptPayload(JSON.parse(stdout.trim()));
          } catch {
            // Host or browser battery events may still provide updates.
          }
        }
      );
    };

    poll();
    window.setInterval(poll, 1500);
  }

  render({ level: 0.72, charging: true, chargingTime: 2880 });
  connectHost();
  connectBatteryApi();
  connectWindowsPower();
})();
