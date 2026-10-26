/* Rumor Engine: a deterministic, illustrative network diffusion model. */
(() => {
  "use strict";

  const COLORS = { uninformed: "#77868a", informed: "#5ad7d0", skeptical: "#d98389", edge: "#39454a", selected: "#f1b860", transmission: "#f1b860" };
  const PRESETS = {
    spark: { size: 100, share: 78, skepticism: 14, seed: 24017, label: "The Spark" },
    skeptics: { size: 100, share: 29, skepticism: 68, seed: 68109, label: "The Skeptics" },
    influencers: { size: 100, share: 50, skepticism: 30, seed: 91524, label: "The Influencers", influencers: true }
  };
  const state = { nodes: [], edges: [], rng: null, seed: 24017, sourceId: null, step: 0, running: false, timer: null, animations: [], loggedMilestones: new Set(), activePreset: "spark", config: {} };

  const $ = (id) => document.getElementById(id);
  const canvas = $("network-canvas"), ctx = canvas.getContext("2d"), wrap = $("canvas-wrap"), tooltip = $("node-tooltip");
  const inputs = { size: $("network-size"), share: $("sharing-probability"), skepticism: $("skepticism"), seed: $("seed") };

  // Mulberry32 makes a given seed repeat the same graph and probability rolls.
  function makeRng(seed) { let value = seed >>> 0; return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const randomInt = (max) => Math.floor(state.rng() * max);

  function currentConfig() { return { size: Number(inputs.size.value), share: Number(inputs.share.value) / 100, skepticism: Number(inputs.skepticism.value) / 100, seed: Math.max(1, Math.floor(Number(inputs.seed.value) || 1)), influencers: PRESETS[state.activePreset]?.influencers || false }; }
  function updateOutputs() { $("network-size-output").value = inputs.size.value; $("sharing-probability-output").value = `${inputs.share.value}%`; $("skepticism-output").value = `${inputs.skepticism.value}%`; }

  function generateNetwork() {
    state.config = currentConfig(); state.seed = state.config.seed; state.rng = makeRng(state.seed); state.step = 0; state.animations = []; state.loggedMilestones = new Set();
    $("event-log").replaceChildren();
    const { size, skepticism, influencers } = state.config;
    state.nodes = Array.from({ length: size }, (_, id) => ({
      id, x: 0.08 + state.rng() * 0.84, y: 0.09 + state.rng() * 0.82,
      trust: clamp(0.58 + (state.rng() - .5) * .5, .18, .95),
      skepticism: clamp(skepticism + (state.rng() - .5) * .35, .03, .96),
      sharing: clamp(0.62 + (state.rng() - .5) * .5, .12, 1),
      reach: clamp(0.75 + (state.rng() - .5) * .28, .4, 1),
      neighbors: new Set(), status: "uninformed", influencer: false
    }));
    const edgeSet = new Set();
    const addEdge = (a, b) => { if (a === b) return; const [low, high] = a < b ? [a, b] : [b, a]; const key = `${low}-${high}`; if (!edgeSet.has(key)) { edgeSet.add(key); state.nodes[low].neighbors.add(high); state.nodes[high].neighbors.add(low); } };
    // A ring guarantees a usable connected graph. Extra links provide randomized communication paths.
    for (let i = 0; i < size; i += 1) addEdge(i, (i + 1) % size);
    const targetEdges = Math.round(size * 3.25);
    while (edgeSet.size < targetEdges) addEdge(randomInt(size), randomInt(size));
    if (influencers) {
      const ranked = [...state.nodes].sort((a, b) => b.trust * b.sharing - a.trust * a.sharing).slice(0, 4);
      ranked.forEach((node) => { node.influencer = true; node.sharing = .96; node.reach = 1; for (let i = 0; i < Math.ceil(size * .14); i += 1) addEdge(node.id, randomInt(size)); });
    }
    state.edges = [...edgeSet].map((key) => key.split("-").map(Number));
    state.sourceId = null; chooseRandomSource(false); logEvent(`Generated ${size}-person network with seed ${state.seed}.`); if (influencers) logEvent("Four high-reach connectors placed in the network.", true);
    updateDashboard(); render();
  }

  function chooseRandomSource(shouldLog = true) {
    const candidates = state.nodes.filter((node) => node.status === "uninformed");
    if (!candidates.length) return;
    state.sourceId = candidates[randomInt(candidates.length)].id;
    $("source-label").textContent = `Source: person ${String(state.sourceId + 1).padStart(3, "0")}`;
    if (shouldLog) { logEvent(`Person ${String(state.sourceId + 1).padStart(3, "0")} selected as the source.`); render(); }
  }

  function seedRumor() {
    if (state.sourceId === null) chooseRandomSource(false);
    const source = state.nodes[state.sourceId];
    if (source.status === "informed") return true;
    if (source.status !== "uninformed") return false;
    source.status = "informed";
    logEvent(`Rumor seeded at person ${String(source.id + 1).padStart(3, "0")}.`, true);
    return true;
  }

  function simulationStep() {
    if (!seedRumor()) { stop(); return; }
    state.step += 1;
    const exposure = new Map();
    // This phase reads only the current state. Newly informed people cannot transmit until a later step.
    state.nodes.filter((node) => node.status === "informed").forEach((source) => {
      source.neighbors.forEach((targetId) => {
        const target = state.nodes[targetId]; if (target.status !== "uninformed") return;
        // Sharing and accepting are separate decisions. Their product is the expected
        // chance for a single path, while several received attempts combine below.
        const shareChance = clamp(state.config.share * source.sharing * source.reach, 0, .98);
        const acceptChance = clamp(target.trust * (1 - target.skepticism), 0, .98);
        if (state.rng() < shareChance) { if (!exposure.has(targetId)) exposure.set(targetId, []); exposure.get(targetId).push({ source, p: acceptChance }); }
      });
    });
    let accepted = 0, rejected = 0;
    // Apply decisions together after all attempts have been collected: no loop-order cascade.
    exposure.forEach((attempts, targetId) => {
      const target = state.nodes[targetId];
      const acceptance = 1 - attempts.reduce((remaining, attempt) => remaining * (1 - attempt.p), 1);
      if (state.rng() < acceptance) {
        target.status = "informed"; accepted += 1;
        const strongest = attempts.reduce((best, attempt) => attempt.p > best.p ? attempt : best);
        state.animations.push({ from: strongest.source.id, to: targetId, start: performance.now(), duration: 420 });
      } else { target.status = "skeptical"; rejected += 1; }
    });
    const informed = state.nodes.filter((node) => node.status === "informed");
    if (accepted) logEvent(`${accepted} people accepted the rumor at step ${String(state.step).padStart(2, "0")}.`);
    if (rejected) logEvent(`${rejected} people declined and became skeptical.`);
    const hub = informed.find((node) => node.neighbors.size >= Math.max(8, state.config.size * .11));
    if (hub && !state.loggedMilestones.has(`hub-${hub.id}`)) { state.loggedMilestones.add(`hub-${hub.id}`); logEvent(`Rumor reached a highly connected person (${hub.neighbors.size} links).`, true); }
    const percent = (informed.length / state.nodes.length) * 100;
    [25, 50, 75].forEach((milestone) => { if (percent >= milestone && !state.loggedMilestones.has(milestone)) { state.loggedMilestones.add(milestone); logEvent(`Spread passed ${milestone}% of the network.`, true); } });
    if (!accepted && exposure.size === 0) { logEvent("No new communication paths are active. Simulation paused.", true); stop(); }
    updateDashboard(); render();
  }

  function start() { if (state.running) return; state.running = true; setRunStatus(); state.timer = window.setInterval(simulationStep, 700); simulationStep(); }
  function stop() { state.running = false; window.clearInterval(state.timer); state.timer = null; setRunStatus(); }
  function setRunStatus() { const status = $("run-status"); status.textContent = state.running ? "Running" : "Paused"; status.dataset.running = String(state.running); }
  function reset() { stop(); generateNetwork(); }

  function updateDashboard() {
    const counts = state.nodes.reduce((all, node) => { all[node.status] += 1; return all; }, { informed: 0, uninformed: 0, skeptical: 0 });
    const percent = state.nodes.length ? Math.round(counts.informed / state.nodes.length * 100) : 0;
    $("informed-count").textContent = counts.informed; $("uninformed-count").textContent = counts.uninformed; $("skeptical-count").textContent = counts.skeptical; $("connection-count").textContent = state.edges.length;
    $("informed-percent").textContent = `${percent}% of network`; $("meter-percent").textContent = `${percent}%`; $("meter-fill").style.width = `${percent}%`; $("step-readout").textContent = `STEP ${String(state.step).padStart(2, "0")}`;
  }
  function logEvent(message, highlight = false) { const log = $("event-log"); const item = document.createElement("li"); if (highlight) item.className = "highlight"; item.innerHTML = `<time>S${String(state.step).padStart(2, "0")}</time>${message}`; log.prepend(item); while (log.children.length > 7) log.lastElementChild.remove(); }

  function resizeCanvas() { const box = wrap.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); render(); }
  function point(node) { const box = canvas.getBoundingClientRect(); return { x: node.x * box.width, y: node.y * box.height }; }
  function render(now = performance.now()) {
    const box = canvas.getBoundingClientRect(); if (!box.width || !box.height) return; ctx.clearRect(0, 0, box.width, box.height);
    ctx.lineWidth = 1; ctx.strokeStyle = COLORS.edge; ctx.globalAlpha = .7; state.edges.forEach(([a, b]) => { const from = point(state.nodes[a]), to = point(state.nodes[b]); ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); });
    state.nodes.forEach((node) => { const p = point(node); const radius = node.influencer ? 5.1 : 3.6; if (node.id === state.sourceId && node.status === "uninformed") { ctx.strokeStyle = COLORS.selected; ctx.lineWidth = 1.5; ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(p.x, p.y, radius + 4.5, 0, Math.PI * 2); ctx.stroke(); } ctx.fillStyle = COLORS[node.status]; ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill(); if (node.influencer) { ctx.strokeStyle = "#eff4f2"; ctx.lineWidth = 1; ctx.globalAlpha = .7; ctx.stroke(); } });
    state.animations = state.animations.filter((animation) => now - animation.start < animation.duration); state.animations.forEach((animation) => { const progress = clamp((now - animation.start) / animation.duration, 0, 1); const from = point(state.nodes[animation.from]), to = point(state.nodes[animation.to]); const x = from.x + (to.x - from.x) * progress, y = from.y + (to.y - from.y) * progress; ctx.fillStyle = COLORS.transmission; ctx.globalAlpha = 1 - progress * .3; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); });
    ctx.globalAlpha = 1; if (state.animations.length) requestAnimationFrame(render);
  }

  function canvasPosition(event) { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  function nearestNode(event) { const pos = canvasPosition(event); let match = null, distance = Infinity; state.nodes.forEach((node) => { const p = point(node), d = Math.hypot(p.x - pos.x, p.y - pos.y); if (d < distance) { distance = d; match = node; } }); return distance < 14 ? match : null; }
  canvas.addEventListener("click", (event) => { const node = nearestNode(event); if (!node || node.status !== "uninformed" || state.running) return; state.sourceId = node.id; $("source-label").textContent = `Source: person ${String(node.id + 1).padStart(3, "0")}`; logEvent(`Person ${String(node.id + 1).padStart(3, "0")} selected as the source.`); render(); });
  canvas.addEventListener("mousemove", (event) => { const node = nearestNode(event); if (!node) { tooltip.hidden = true; return; } const pos = canvasPosition(event); tooltip.hidden = false; tooltip.style.left = `${pos.x}px`; tooltip.style.top = `${pos.y}px`; tooltip.textContent = `Person ${String(node.id + 1).padStart(3, "0")} · ${node.neighbors.size} links${node.influencer ? " · high reach" : ""}`; });
  canvas.addEventListener("mouseleave", () => { tooltip.hidden = true; });

  Object.values(inputs).forEach((input) => input.addEventListener("input", updateOutputs));
  [inputs.size, inputs.share, inputs.skepticism, inputs.seed].forEach((input) => input.addEventListener("change", () => { state.activePreset = "custom"; document.querySelectorAll(".preset").forEach((button) => button.classList.remove("active")); reset(); }));
  $("start-button").addEventListener("click", start); $("pause-button").addEventListener("click", stop); $("step-button").addEventListener("click", () => { stop(); simulationStep(); }); $("reset-button").addEventListener("click", reset); $("random-source-button").addEventListener("click", () => chooseRandomSource());
  document.querySelectorAll(".preset").forEach((button) => button.addEventListener("click", () => { const preset = PRESETS[button.dataset.preset]; state.activePreset = button.dataset.preset; inputs.size.value = preset.size; inputs.share.value = preset.share; inputs.skepticism.value = preset.skepticism; inputs.seed.value = preset.seed; document.querySelectorAll(".preset").forEach((item) => item.classList.toggle("active", item === button)); updateOutputs(); reset(); }));
  window.addEventListener("resize", resizeCanvas); updateOutputs(); generateNetwork(); requestAnimationFrame(resizeCanvas);
})();
