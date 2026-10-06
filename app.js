/**
 * The Meter — AI Usage Billing Engine
 * Built with MoneyMagic Fintech UI System & Micro-Animations
 */

/* ==========================================================================
   1. CORE BILLING ENGINE (Exact Logic Preserved 100%)
   ========================================================================== */
const ROLES = {
    super_admin: { "*": ["read", "write"] },
    all_reader: { "*": ["read"] },
    all_writer: { "*": ["read", "write"] },
    event_ingestor: { event: ["write"] },
    event_reader: { event: ["read"] }
};

const r2 = x => (Math.round(x * 100 + (x < 0 ? -1e-9 : 1e-9)) / 100);

const pd = s => {
    s = String(s).trim().replace(" ", "T");
    if (!/T/.test(s)) s += "T00:00";
    return new Date(s + (/Z|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
};

const addMonth = d => {
    const x = new Date(d), day = x.getUTCDate();
    x.setUTCDate(1);
    x.setUTCMonth(x.getUTCMonth() + 1);
    const dim = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
    x.setUTCDate(Math.min(day, dim));
    return x;
};

const uid = p => p + "_" + Math.random().toString(36).slice(2, 8);

function priceTiers(tiers, mode, u) {
    let lines = [];
    if (u <= 0) return [0, lines];
    if (mode === "volume") {
        for (const [up, unit, flat] of tiers) {
            if (up == null || u <= up) {
                const a = u * unit + flat;
                return [a, [[`${u}k tokens × ₹${unit} (volume tier) + flat ₹${flat}`, a]]];
            }
        }
    }
    let lo = 0;
    for (const [up, unit, flat] of tiers) {
        if (u <= lo) break;
        const top = up == null ? u : Math.min(u, up), qty = top - lo, a = qty * unit + flat;
        lines.push([`${qty}k tokens × ₹${unit} (slab) + flat ₹${flat}`, a]);
        if (up == null) break;
        lo = up;
    }
    return [lines.reduce((s, l) => s + l[1], 0), lines];
}

function Eng() {
    const S = { c: [], p: [], s: [], e: {}, i: [] };
    let broker = true;

    const need = (r, e, a) => {
        const p = ROLES[r] || {};
        if (!((p["*"] || []).includes(a) || (p[e] || []).includes(a))) {
            throw new Error(`403 Forbidden – this role cannot ${a} ${e} data.`);
        }
    };

    const plan = id => {
        const p = S.p.find(x => x.id === id);
        if (!p) throw new Error("Please pick a plan first.");
        return p;
    };

    const save = inv => {
        inv.id = uid("inv");
        inv.total = r2(inv.total);
        S.i.push(inv);
        return inv;
    };

    return {
        S,
        setBroker: v => broker = v,
        getBroker: () => broker,
        addC(r, n) {
            need(r, "customer", "write");
            if (!n.trim()) throw new Error("Enter a customer name.");
            const c = { id: uid("cust"), name: n.trim() };
            S.c.push(c);
            return c.id;
        },
        customers(r) {
            need(r, "customer", "read");
            return S.c;
        },
        plans(r) {
            need(r, "plan", "read");
            return S.p;
        },
        addP(r, name, base, mode, tiers) {
            need(r, "plan", "write");
            if (!tiers.length || tiers.at(-1)[0] != null) throw new Error("The last tier must be '-' (no limit).");
            const p = { id: uid("plan"), name, base: +base, mode, tiers };
            S.p.push(p);
            return p.id;
        },
        sub(r, c, p, start, idem) {
            need(r, "subscription", "write");
            if (!c) throw new Error("Please pick a customer first.");
            plan(p);
            const st = pd(start);
            if (idem) {
                const x = S.s.find(s => s.idem === idem);
                if (x) return { id: x.id, replay: true };
            }
            if (S.s.some(s => s.c === c && s.status === "active")) {
                throw new Error("409 Conflict – this customer already has an active subscription. Use Upgrade instead.");
            }
            const end = addMonth(st), s = { id: uid("sub"), c, p, status: "active", ps: st, pe: end, ss: st, se: end, idem: idem || null };
            S.s.push(s);
            return { id: s.id, end };
        },
        upg(r, c, np, at) {
            need(r, "subscription", "write");
            at = pd(at);
            const o = S.s.find(s => s.c === c && s.status === "active");
            if (!o) throw new Error("This customer has no active subscription yet.");
            if (o.p === np) throw new Error("409 Conflict – the customer is already on that plan.");
            if (!(at >= o.ss && at < o.pe)) throw new Error("The upgrade date must fall inside the current billing month.");
            const rem = (o.pe - at) / (o.pe - o.ps), op = plan(o.p), n = plan(np), cr = -r2(op.base * rem), ch = r2(n.base * rem);
            o.status = "ended";
            o.se = at;
            S.s.push({ id: uid("sub"), c, p: np, status: "active", ps: o.ps, pe: o.pe, ss: at, se: o.pe, idem: null });
            return save({
                kind: "PRORATION",
                c,
                lines: [
                    [`Credit for unused part of '${op.name}' (${(rem * 100).toFixed(2)}% of month left)`, cr],
                    [`Charge for '${n.name}' for the remaining ${(rem * 100).toFixed(2)}%`, ch]
                ],
                total: cr + ch
            });
        },
        ingest(r, id, c, tok, ts) {
            need(r, "event", "write");
            if (!broker) throw new Error("503 Service Unavailable – the message broker is down. Nothing was stored; retry in 5 seconds.");
            if (!c) throw new Error("Please pick a customer first.");
            if (!String(id).trim()) throw new Error("Event ID is required.");
            if (!(tok >= 0) || tok === "") throw new Error("Tokens must be 0 or more.");
            if (S.e[id]) return "duplicate";
            S.e[id] = { c, tok: +tok, ts: pd(ts) };
            return "accepted";
        },
        total(r, c) {
            need(r, "event", "read");
            return Object.values(S.e).filter(e => e.c === c).reduce((s, e) => s + e.tok, 0);
        },
        gen(r, c) {
            need(r, "invoice", "write");
            const subs = S.s.filter(s => s.c === c);
            if (!subs.length) throw new Error("This customer has no subscription yet (Step 2).");
            let lines = [], tot = 0;
            for (const s of subs) {
                const t = Object.values(S.e).filter(e => e.c === c && e.ts >= s.ss && e.ts < s.se).reduce((a, e) => a + e.tok, 0);
                if (!t) continue;
                const p = plan(s.p), [a, ls] = priceTiers(p.tiers, p.mode, t / 1000);
                lines.push([`${p.name} plan – ${t.toLocaleString("en-IN")} tokens (${s.ss.toISOString().slice(0, 10)} to ${s.se.toISOString().slice(0, 10)})`, r2(a)]);
                ls.forEach(l => lines.push(["  " + l[0], r2(l[1])]));
                tot += a;
            }
            if (!lines.length) throw new Error("No usage recorded yet for this customer (Step 3).");
            return save({ kind: "USAGE", c, lines, total: tot });
        },
        hist(r, c) {
            need(r, "invoice", "read");
            return S.i.filter(i => i.c === c);
        }
    };
}

/* ==========================================================================
   2. PERSONAS & APPLICATION STATE
   ========================================================================== */
const PERSONAS = {
    admin: {
        role: "super_admin",
        name: "Admin",
        who: "Billing owner",
        can: "Everything: set up, subscribe, send usage, create & view invoices.",
        cant: ""
    },
    user1: {
        role: "event_ingestor",
        name: "User 1",
        who: "API Ingestor Service",
        can: "Send usage events (Step 3).",
        cant: "Cannot see customers, plans or invoices (403 Forbidden)."
    },
    user2: {
        role: "all_reader",
        name: "User 2",
        who: "Finance Analyst",
        can: "View customers, plans, usage totals and invoices.",
        cant: "Cannot create or change anything (403 Forbidden)."
    }
};

let who = "admin";
const E = Eng();
const $ = id => document.getElementById(id);
const R = () => PERSONAS[who].role;
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const inr = n => (n < 0 ? "−" : "") + "₹ " + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Audio Synthesizer
let audioCtx = null;
let soundEnabled = true;

function playSound(type = 'click') {
    if (!soundEnabled) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const now = audioCtx.currentTime;

        if (type === 'click') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(320, now + 0.04);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
            osc.start(now);
            osc.stop(now + 0.04);
        } else if (type === 'pop') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(450, now);
            osc.frequency.exponentialRampToValueAtTime(850, now + 0.06);
            gain.gain.setValueAtTime(0.09, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
            osc.start(now);
            osc.stop(now + 0.07);
        } else if (type === 'success') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.08);
            osc.frequency.setValueAtTime(783.99, now + 0.16);
            gain.gain.setValueAtTime(0.09, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
            osc.start(now);
            osc.stop(now + 0.28);
        }
    } catch (e) {}
}

// Log Feed
function log(m, k) {
    const d = document.createElement("div");
    d.className = k ? "l-" + k : "";
    d.textContent = `${new Date().toLocaleTimeString()}  ${m}`;
    $("log").prepend(d);
}

// Toast
let toastTimeout;
function toast(m, k = 'ok') {
    const toastElem = $("toastNotification");
    const msgElem = $("toastMessage");
    if (!toastElem) return;
    clearTimeout(toastTimeout);
    msgElem.textContent = m;
    toastElem.classList.add("active");
    toastTimeout = setTimeout(() => toastElem.classList.remove("active"), 4200);
}

const chip = (id, m, k) => {
    const elem = $(id);
    if (elem) elem.innerHTML = `<div class="chip c-${k}">${esc(m)}</div>`;
};

function invHtml(i) {
    return `<table><tr><th>${i.kind === "PRORATION" ? "Proration" : "Usage"} invoice <small style="color:#A1A1AA;font-family:monospace">${i.id}</small></th><th class="n">Amount</th></tr>` +
        i.lines.map(l => `<tr class="${l[0].startsWith("  ") ? "d" : ""}"><td>${esc(l[0].trim())}</td><td class="n ${l[1] < 0 ? "neg" : ""}">${inr(l[1])}</td></tr>`).join("") +
        `<tr class="t"><td>Total to pay</td><td class="n">${inr(i.total)}</td></tr></table>`;
}

function fill(ids, rows, lab) {
    for (const id of ids) {
        const el = $(id);
        if (!el) continue;
        const v = el.value;
        el.innerHTML = rows.length ? rows.map(r => `<option value="${r.id}">${esc(lab(r))}</option>`).join("") : '<option value="">— none yet (see Step 1) —</option>';
        if (v) el.value = v;
    }
}

// Number Count-Up Animation
function animateValue(elem, start, end, duration = 750, prefix = '₹ ', suffix = '') {
    if (!elem) return;
    const startTime = performance.now();
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        const currentVal = start + (end - start) * ease;
        elem.textContent = `${prefix}${currentVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            elem.textContent = `${prefix}${end.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
        }
    }
    requestAnimationFrame(update);
}

// Refresh Dashboard Widgets & Catalog
function refresh() {
    let cs = [], ps = [], cat = "";
    try {
        cs = E.customers(R());
        ps = E.plans(R());
        cat = `<table><tr><th>Customers</th><th>Plans</th></tr><tr><td>${cs.map(c => esc(c.name)).join("<br>") || "—"}</td><td>${ps.map(p => `${esc(p.name)} · ${inr(p.base)}/month · ${p.mode}`).join("<br>") || "—"}</td></tr></table>`;
    } catch {
        cat = '<div class="chip c-warn">Your role cannot view this list (by design).</div>';
    }
    if ($("cat")) $("cat").innerHTML = cat;
    fill(["sc", "ic", "modalCustomerSelect"], cs, c => c.name);
    fill(["sp", "up"], ps, p => `${p.name} (${inr(p.base)}/month)`);
    fill(["ec"], E.S.c, c => c.name + " (" + c.id + ")");

    // Update Right Column Metric Widgets
    if ($("activeCustomersCount")) {
        $("activeCustomersCount").textContent = `${E.S.c.length} Customer${E.S.c.length === 1 ? '' : 's'}`;
    }
    if ($("totalTokensRecorded")) {
        const totalTok = Object.values(E.S.e).reduce((s, e) => s + e.tok, 0);
        $("totalTokensRecorded").textContent = `${totalTok.toLocaleString("en-IN")} tok`;
    }
    if ($("metricInvoicedTotal")) {
        const lastInv = E.S.i.at(-1);
        if (lastInv) {
            $("metricInvoicedTotal").textContent = inr(lastInv.total);
            if ($("balanceDisplay")) {
                animateValue($("balanceDisplay"), 0, Math.max(0, lastInv.total), 600);
            }
        }
    }
}

// Persona Switcher
function persona() {
    const p = PERSONAS[who];
    $("who").innerHTML = `<b>${p.name} – ${esc(p.who)}</b><span class="yes">✓ Can: ${esc(p.can)}</span>${p.cant ? `<span class="no">✗ ${esc(p.cant)}</span>` : ""}`;
    [...$("seg").children].forEach(b => b.classList.toggle("on", b.dataset.w === who));
}

// Message Broker Outage Simulation
function brk() {
    const up = $("brk").checked;
    E.setBroker(up);
    const txt = $("brkTxt");
    const toggle = document.querySelector(".broker-pill-toggle");
    if (toggle) toggle.classList.toggle("down", !up);
    if (txt) txt.textContent = up ? "Broker: ONLINE" : "Broker: 503 OUTAGE";
    const brokerTx = $("brokerTxBadge");
    if (brokerTx) {
        brokerTx.textContent = up ? "200 OK" : "503 OUTAGE";
        brokerTx.style.color = up ? "#0E0E10" : "#EF4444";
    }
}

// Step & Tab Navigation
function show(k) {
    // k = 0: Dashboard; k = 1: Step 1; k = 2: Step 2; k = 3: Step 3; k = 4: Step 4; k = 5: Step 5
    document.querySelectorAll(".tab-view").forEach((view, idx) => {
        view.classList.toggle("active", idx === k);
    });
    document.querySelectorAll("#steps .nav-tab").forEach((btn, idx) => {
        btn.classList.toggle("active", idx === k);
    });
    playSound('pop');
}

const newId = () => {
    const id = "evt-" + Math.random().toString(36).slice(2, 8);
    if ($("ei")) $("ei").value = id;
    if ($("modalEventId")) $("modalEventId").value = id;
    return id;
};

function tokensNow(c) {
    try {
        return ` Total recorded: ${E.total(R(), c).toLocaleString("en-IN")} tokens.`;
    } catch {
        return " (This role cannot read usage totals.)";
    }
}

/* ==========================================================================
   3. ACTION HANDLERS
   ========================================================================== */
const A = {
    sample() {
        const t1 = [[100, 10, 0], [500, 8, 0], [null, 5, 0]], t2 = [[100, 8, 0], [500, 6, 0], [null, 4, 0]];
        const c = E.addC(R(), "Acme AI");
        E.addP(R(), "Starter", 1000, "graduated", t1);
        E.addP(R(), "Pro", 3000, "graduated", t2);
        // Also auto-subscribe & ingest demo events so dashboard looks immediately vibrant
        try {
            E.sub(R(), c, E.S.p[0].id, "2026-03-01", "init-demo");
            E.ingest(R(), "evt-seed-01", c, 50000, "2026-03-05T10:00");
            E.upg(R(), c, E.S.p[1].id, "2026-03-15");
        } catch (e) {}

        log("Sample data loaded: Acme AI, Starter ₹1,000, Pro ₹3,000", "ok");
        toast("Sample dataset loaded! Active on dashboard.", "ok");
        playSound('success');
        refresh();
        show(0);
    },
    addC() {
        E.addC(R(), $("cn").value);
        log("Customer added: " + $("cn").value, "ok");
        toast("Customer added: " + $("cn").value, "ok");
        playSound('success');
    },
    addP() {
        const t = $("pt").value.trim().split("\n").map(l => {
            const [u, p, f] = l.split(",").map(x => x.trim());
            return [u === "-" ? null : +u, +p, +f];
        });
        E.addP(R(), $("pn").value, $("pb").value, $("pm").value, t);
        log("Plan added: " + $("pn").value, "ok");
        toast("Plan added: " + $("pn").value, "ok");
        playSound('success');
    },
    sub() {
        const r = E.sub(R(), $("sc").value, $("sp").value, $("sd").value, $("ik").value);
        const m = r.replay ? `Same retry-safe key – returned existing subscription ${r.id}. No duplicate created.` : `Subscribed. Billing month runs ${$("sd").value} to ${r.end.toISOString().slice(0, 10)}.`;
        chip("r1", m, r.replay ? "warn" : "ok");
        log(m, "ok");
        toast(m, r.replay ? "warn" : "ok");
        playSound(r.replay ? 'pop' : 'success');
    },
    upg() {
        const i = E.upg(R(), $("sc").value, $("up").value, $("ua").value);
        $("r1b").innerHTML = invHtml(i);
        log("Upgrade prorated, net " + inr(i.total), "ok");
        toast("Upgrade prorated: " + inr(i.total), "ok");
        playSound('success');
    },
    send() {
        const r = E.ingest(R(), $("ei").value, $("ec").value, $("et").value, $("es").value);
        const ex = tokensNow($("ec").value);
        if (r === "accepted") {
            chip("r2", "✓ Event accepted and stored." + ex, "ok");
            log(`Event ${$("ei").value} accepted`, "ok");
            toast(`Event ${$("ei").value} accepted!`, "ok");
            playSound('success');
        } else {
            chip("r2", "Duplicate – event ID was already counted. Ignored; no double-bill." + ex, "warn");
            log(`Event ${$("ei").value} ignored (duplicate)`, "ok");
            toast("Duplicate event ID ignored (protected)!", "warn");
            playSound('pop');
        }
    },
    newId,
    gen() {
        const i = E.gen(R(), $("ic").value);
        $("r3").innerHTML = invHtml(i);
        log("Invoice generated: " + inr(i.total), "ok");
        toast("Invoice generated: " + inr(i.total), "ok");
        playSound('success');
    },
    hist() {
        const h = E.hist(R(), $("ic").value);
        $("r3").innerHTML = h.length ? h.map(invHtml).join("<br>") : '<div class="chip c-warn">No invoices yet.</div>';
        playSound('pop');
    },
    runT() {
        const o = runTests();
        const r4 = $("r4");
        if (r4) {
            r4.innerHTML = o.map(t => `<div class="t-card"><span class="pill ${t.ok ? "up" : "down"}">${t.ok ? "PASS" : "FAIL"}</span><div><b>${esc(t.name)}</b><small>${esc(t.d)}</small></div></div>`).join("") +
                `<div class="chip ${o.every(t => t.ok) ? "c-ok" : "c-bad"}" style="margin-top:14px;font-size:14px;font-weight:700">${o.filter(t => t.ok).length} of ${o.length} tests passed successfully</div>`;
        }
        if ($("testSuiteBadge")) {
            $("testSuiteBadge").textContent = `${o.filter(t => t.ok).length} of ${o.length} Pass`;
        }
        playSound(o.every(t => t.ok) ? 'success' : 'pop');
        toast(`Test Suite Complete: ${o.filter(t => t.ok).length}/${o.length} Passed`, "ok");
        show(5);
    }
};

/* ==========================================================================
   4. ENGINE TEST SUITE (100% Exact Verification Logic)
   ========================================================================== */
function runTests() {
    const Ad = "super_admin", out = [];
    const t = (name, f) => {
        let ok, d;
        try { [ok, d] = f(); } catch (e) { ok = false; d = e.message; }
        out.push({ name, ok, d });
    };
    const mk = () => {
        const e = Eng(), c = e.addC(Ad, "Acme"), s = e.addP(Ad, "Starter", 1000, "graduated", [[null, 10, 0]]), b = e.addP(Ad, "Pro", 3000, "graduated", [[null, 8, 0]]);
        return [e, c, s, b];
    };
    const throws = f => {
        try { f(); return null; } catch (e) { return e.message; }
    };

    t("Required test 1 – a duplicate usage event is counted only once", () => {
        const [e, c, s] = mk();
        e.sub(Ad, c, s, "2026-03-01");
        const a = e.ingest("event_ingestor", "evt-1", c, 1000, "2026-03-02");
        const b = e.ingest("event_ingestor", "evt-1", c, 1000, "2026-03-02");
        const n = e.total(Ad, c);
        return [n === 1000 && b === "duplicate", `Same event sent twice (1,000 tokens): 1st ${a}, 2nd ${b}. Total recorded = ${n}.`];
    });

    t("Required test 2 – mid-month upgrade is prorated correctly", () => {
        const [e, c, s, b] = mk();
        e.sub(Ad, c, s, "2026-03-01");
        const i = e.upg(Ad, c, b, "2026-03-15");
        return [i.lines[0][1] === -548.39 && i.lines[1][1] === 1645.16 && i.total === 1096.77, `₹1,000 → ₹3,000 plan on 15 March (17 of 31 days left): −548.39 + 1,645.16 = ${i.total}. By hand: 2000 × 17/31 = 1096.77.`];
    });

    t("Required test 3 – tiered pricing equals the hand calculation", () => {
        const g = [[100, 10, 0], [500, 8, 0], [null, 5, 0]];
        const a = priceTiers(g, "graduated", 250)[0];
        const v = priceTiers(g, "volume", 250)[0];
        const f = priceTiers([[100, 10, 0], [null, 8, 50]], "graduated", 250)[0];
        return [a === 2200 && v === 2000 && f === 2250, `250k tokens: graduated = 100×10 + 150×8 = ${a}; volume = 250×8 = ${v}; graduated with ₹50 flat fee on tier 2 = ${f}.`];
    });

    t("Improvement 1 – broker down returns 503 and stores nothing", () => {
        const [e, c] = mk();
        e.setBroker(false);
        const m = throws(() => e.ingest(Ad, "x", c, 5, "2026-03-02"));
        return [!!m && m.startsWith("503") && e.total(Ad, c) === 0, "Error raised, nothing stored: " + m];
    });

    t("Improvement 2a – retried subscription is not duplicated", () => {
        const [e, c, s] = mk();
        const a = e.sub(Ad, c, s, "2026-03-01", "k1");
        const b = e.sub(Ad, c, s, "2026-03-01", "k1");
        const m = throws(() => e.sub(Ad, c, s, "2026-03-01", "k2"));
        return [a.id === b.id && !!m && m.startsWith("409"), "Same key returned the same subscription; a different key for already-subscribed customer was rejected (409)."];
    });

    t("Improvement 2b – usage-only key cannot read customer data", () => {
        const [e, c] = mk();
        const m1 = throws(() => e.customers("event_ingestor"));
        const m2 = throws(() => e.hist("event_ingestor", c));
        return [!!m1 && !!m2, "User 1 (usage-only) was refused reads of customers and invoices (403)."];
    });

    return out;
}

/* ==========================================================================
   5. UI INITIALIZATION & EVENT LISTENERS
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
    // Populate Persona Selector
    $("seg").innerHTML = Object.entries(PERSONAS).map(([k, p]) =>
        `<button data-w="${k}">${p.name}</button>`
    ).join("");

    // Setup Bar Chart Hover & Growth
    setTimeout(() => {
        document.querySelectorAll('.bar').forEach(b => {
            const h = b.style.getPropertyValue('--target-height');
            if (h) b.style.height = h;
        });
    }, 150);

    const chartCols = document.querySelectorAll('.chart-col');
    const chartTooltip = $("chartTooltip");
    const tooltipMonth = $("tooltipMonth");
    const tooltipGreyVal = $("tooltipGreyVal");
    const tooltipBlackVal = $("tooltipBlackVal");

    chartCols.forEach(col => {
        col.addEventListener('mouseenter', () => {
            const month = col.getAttribute('data-month');
            const grey = col.getAttribute('data-grey');
            const black = col.getAttribute('data-black');
            tooltipMonth.textContent = month;
            tooltipGreyVal.textContent = `${grey} tokens`;
            tooltipBlackVal.textContent = `${black} tokens`;

            const colRect = col.getBoundingClientRect();
            const cardRect = $("reportCard").getBoundingClientRect();
            chartTooltip.style.left = `${colRect.left - cardRect.left + colRect.width / 2}px`;
            chartTooltip.style.top = `${colRect.top - cardRect.top - 12}px`;
            chartTooltip.classList.add('active');
            playSound('click');
        });
        col.addEventListener('mouseleave', () => {
            chartTooltip.classList.remove('active');
        });
    });

    // Donut Simulation Toggle (Graduated vs Volume)
    const timeframeToggle = $("timeframeToggle");
    const toggleOptions = document.querySelectorAll(".toggle-pill-option");
    const spendingAmountDisplay = $("spendingAmountDisplay");
    const spendingLabelDisplay = $("spendingLabelDisplay");
    const donutWhite = document.querySelector(".donut-ring.ring-white");
    const donutBlack = document.querySelector(".donut-ring.ring-black");

    toggleOptions.forEach(btn => {
        btn.addEventListener('click', () => {
            const period = btn.getAttribute('data-period');
            timeframeToggle.setAttribute('data-active', period);
            toggleOptions.forEach(o => o.classList.remove('active'));
            btn.classList.add('active');
            playSound('pop');

            if (period === 'graduated') {
                animateValue(spendingAmountDisplay, 2000, 2200, 500, '₹ ');
                spendingLabelDisplay.textContent = '250K TOKENS (GRADUATED)';
                donutWhite.setAttribute('stroke-dasharray', '240 352');
                donutBlack.setAttribute('stroke-dasharray', '110 352');
                donutBlack.setAttribute('stroke-dashoffset', '-242');
            } else {
                animateValue(spendingAmountDisplay, 2200, 2000, 500, '₹ ');
                spendingLabelDisplay.textContent = '250K TOKENS (VOLUME TIER)';
                donutWhite.setAttribute('stroke-dasharray', '210 352');
                donutBlack.setAttribute('stroke-dasharray', '140 352');
                donutBlack.setAttribute('stroke-dashoffset', '-212');
            }
        });
    });

    // Click Dispatcher for Actions
    document.addEventListener("click", e => {
        const b = e.target.closest("[data-a]");
        if (b) {
            try {
                A[b.dataset.a]();
            } catch (err) {
                log(err.message, "bad");
                toast(err.message, "bad");
                if (b.dataset.a === "send") chip("r2", err.message, "bad");
            }
            refresh();
            return;
        }

        const w = e.target.closest("[data-w]");
        if (w) {
            who = w.dataset.w;
            persona();
            refresh();
            log("Switched to " + PERSONAS[who].name + " (" + PERSONAS[who].role + ")", "ok");
            toast("Active Persona: " + PERSONAS[who].name, "ok");
            playSound('pop');
            return;
        }

        const s = e.target.closest("[data-s]");
        if (s) {
            show(+s.dataset.s);
            return;
        }
    });

    // Broker Switch
    $("brk").addEventListener("change", () => {
        brk();
        const isOn = $("brk").checked;
        log("Broker pipeline " + (isOn ? "ONLINE" : "OFFLINE (simulated 503 outage)"), isOn ? "ok" : "bad");
        toast(isOn ? "Broker pipeline restored to ONLINE (200)" : "Simulated Broker Outage: Engine will return 503!", isOn ? "ok" : "bad");
        playSound(isOn ? 'success' : 'click');
    });

    // Presentation Mode Switcher
    const viewToggleBtn = $("viewToggleBtn");
    const viewToggleText = $("viewToggleText");
    if (viewToggleBtn) {
        viewToggleBtn.addEventListener("click", () => {
            document.body.classList.toggle("fullscreen-mode");
            const isFull = document.body.classList.contains("fullscreen-mode");
            viewToggleText.textContent = isFull ? "Presentation Frame" : "Full Screen";
            playSound('pop');
        });
    }

    // Audio Mute Toggle
    const soundToggleBtn = $("soundToggleBtn");
    const soundStatus = $("soundStatus");
    if (soundToggleBtn) {
        soundToggleBtn.addEventListener("click", () => {
            soundEnabled = !soundEnabled;
            soundStatus.textContent = soundEnabled ? "ON" : "OFF";
            if (soundEnabled) playSound('pop');
            toast(`Sound effects ${soundEnabled ? 'enabled' : 'muted'}`, 'ok');
        });
    }

    // Pro Plan Heart Toggle
    const proPlanHeartBtn = $("proPlanHeartBtn");
    if (proPlanHeartBtn) {
        proPlanHeartBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const icon = proPlanHeartBtn.querySelector('.heart-icon');
            if (icon) {
                icon.classList.toggle('liked');
                playSound('pop');
                toast(icon.classList.contains('liked') ? 'Pro Plan marked as default recommendation ♥' : 'Favorite removed', 'ok');
            }
        });
    }

    // Activity Drawer Toggle
    const activityDrawerToggle = $("activityDrawerToggle");
    const activityDrawer = $("activityDrawer");
    if (activityDrawerToggle && activityDrawer) {
        activityDrawerToggle.addEventListener("click", () => {
            activityDrawer.classList.toggle("collapsed");
            playSound('click');
        });
    }

    // Quick Event Ingestion Modal
    const quickModal = $("quickEventModal");
    const openSendEventModalBtn = $("openSendEventModalBtn");
    const modalGenIdBtn = $("modalGenIdBtn");
    const modalSubmitEventBtn = $("modalSubmitEventBtn");
    const modalChips = document.querySelectorAll(".quick-chips .chip-btn");

    if (openSendEventModalBtn && quickModal) {
        openSendEventModalBtn.addEventListener("click", () => {
            newId();
            quickModal.classList.add("active");
            playSound('pop');
        });
    }

    document.querySelectorAll(".modal-close-btn, .modal-close-action").forEach(btn => {
        btn.addEventListener("click", () => {
            quickModal.classList.remove("active");
            playSound('click');
        });
    });

    if (modalGenIdBtn) {
        modalGenIdBtn.addEventListener("click", () => {
            newId();
            playSound('click');
        });
    }

    modalChips.forEach(chipBtn => {
        chipBtn.addEventListener("click", () => {
            modalChips.forEach(c => c.classList.remove("active"));
            chipBtn.classList.add("active");
            const amt = chipBtn.getAttribute("data-tokens");
            if ($("modalTokensInput")) $("modalTokensInput").value = amt;
            playSound('click');
        });
    });

    if (modalSubmitEventBtn) {
        modalSubmitEventBtn.addEventListener("click", () => {
            try {
                const c = $("modalCustomerSelect").value;
                const id = $("modalEventId").value;
                const tok = $("modalTokensInput").value;
                const ts = new Date().toISOString();
                const res = E.ingest(R(), id, c, tok, ts);
                if (res === "accepted") {
                    log(`API Event ${id} ingested (${tok} tokens)`, "ok");
                    toast(`Event ${id} accepted: ${tok} tokens!`, "ok");
                    playSound('success');
                } else {
                    log(`API Event ${id} rejected: DUPLICATE`, "bad");
                    toast(`Event ${id} rejected: Already ingested (no double bill)!`, "warn");
                    playSound('pop');
                }
                quickModal.classList.remove("active");
                refresh();
            } catch (err) {
                log(err.message, "bad");
                toast(err.message, "bad");
            }
        });
    }

    // Brand Home Button
    const brandHomeBtn = $("brandHomeBtn");
    if (brandHomeBtn) {
        brandHomeBtn.addEventListener("click", () => show(0));
    }

    // Click handler for Tilted Cards
    document.querySelectorAll(".tx-card").forEach(card => {
        card.addEventListener("click", () => {
            const title = card.getAttribute("data-title");
            const desc = card.getAttribute("data-desc");
            const amt = card.getAttribute("data-amount");
            toast(`${title}: ${desc} (${amt})`, "ok");
            playSound('click');
        });
    });

    // 3D Parallax on Tablet Wrapper
    const wrapper = $("dashboardWrapper");
    if (wrapper && window.innerWidth > 992) {
        wrapper.addEventListener("mousemove", e => {
            if (document.body.classList.contains("fullscreen-mode")) return;
            const r = wrapper.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width - 0.5;
            const y = (e.clientY - r.top) / r.height - 0.5;
            wrapper.style.transform = `perspective(1200px) rotateX(${y * -2.2}deg) rotateY(${x * 2.2}deg)`;
        });
        wrapper.addEventListener("mouseleave", () => {
            wrapper.style.transform = "perspective(1200px) rotateX(0deg) rotateY(0deg)";
        });
    }

    // Initial Engine Bootstrap
    window.runTests = runTests;
    newId();
    persona();
    brk();
    show(0);
    // Auto-load sample data for stunning out-of-the-box appearance
    A.sample();
    log("The Meter initialized with MoneyMagic design system. All 5 test suites ready.", "ok");
});
