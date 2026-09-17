import QRCode from "qrcode";
import { encodeFunctionData } from "viem";
import { predict, saltOf, fmtUsdc18, ARC, type InvoiceState } from "./lib/pigeonhole";
import { FACTORY, TREASURY, DEPLOY_BLOCK, pub, factoryAbi, invoiceState, sweptEvents, connectWallet, txUrl, addrUrl } from "./chain";

const app = () => document.getElementById("app")!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// localStorage: invoice ids this browser created (convenience only; treasury view also reads Swept events)
const KEY = "pigeonhole.invoices";
type Saved = { id: string; amount?: string; from?: string };
const load = (): Saved[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const remember = (s: Saved) => {
  const prev = load().find((x) => x.id === s.id);
  if (prev?.from) s.from = prev.from; // re-creating an id must never post-date its scan window (earlier payments would vanish)
  const a = load().filter((x) => x.id !== s.id); a.unshift(s); try { localStorage.setItem(KEY, JSON.stringify(a.slice(0, 50))); } catch {}
};

function badge(st: InvoiceState["status"]) {
  const cls = st.toLowerCase();
  return `<span class="badge ${cls}"><span class="dot"></span>${st}</span>`;
}
function copyBtn(text: string) { return `<span class="copy" data-copy="${esc(text)}">copy</span>`; }

// ---------- New invoice ----------
function viewNew() {
  app().innerHTML = `
    <section class="hero">
      <h1>A USDC address per invoice — with no key to guard</h1>
      <p>Type an invoice id. You get a fresh Arc deposit address that exists before any contract does.
      When it's paid, one permissionless transaction sweeps it to the treasury and the address disappears —
      reusable forever, with no private key anywhere.</p>
    </section>
    <div class="card">
      <label for="id">Invoice id</label>
      <input id="id" placeholder="e.g. acme-2026-0042" autocomplete="off" />
      <label for="amt">Amount asked (USDC, optional)</label>
      <input id="amt" placeholder="e.g. 0.02" inputmode="decimal" />
      <div class="row" style="margin-top:16px"><button id="go">Create deposit address →</button></div>
      <p class="hint">No transaction, no key. The address is <code>CREATE2(factory, keccak256(id), treasury)</code> — computed offline, verified on-chain.</p>
    </div>`;
  const go = async () => {
    const id = (document.getElementById("id") as HTMLInputElement).value.trim();
    const amt = (document.getElementById("amt") as HTMLInputElement).value.trim();
    if (!id) return;
    // Record the creation block in the URL so the invoice view scans from here, not from the factory's deploy block
    // (the RPC caps eth_getLogs at 10k blocks per call; the chain adds ~170k blocks a day).
    const from = await pub.getBlockNumber().catch(() => DEPLOY_BLOCK);
    remember({ id, amount: amt || undefined, from: from.toString() });
    const q = new URLSearchParams(); if (amt) q.set("amt", amt); q.set("from", from.toString());
    location.hash = `#/i/${encodeURIComponent(id)}?${q}`;
  };
  document.getElementById("go")!.onclick = go;
  (document.getElementById("id") as HTMLInputElement).addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

// ---------- Invoice detail ----------
async function viewInvoice(id: string, amtStr?: string, fromStr?: string) {
  const salt = saltOf(id);
  const pigeonhole = predict(FACTORY, TREASURY, salt);
  if (amtStr && !/^\d+(\.\d{1,6})?$/.test(amtStr)) amtStr = undefined; // ignore a malformed ?amt= instead of throwing
  const amount18 = amtStr ? BigInt(Math.round(parseFloat(amtStr) * 1e6)) * 10n ** 12n : undefined;
  const fromBlock = fromStr && /^\d+$/.test(fromStr) ? BigInt(fromStr) : (load().find((s) => s.id === id)?.from ? BigInt(load().find((s) => s.id === id)!.from!) : DEPLOY_BLOCK);
  const filter = `eth_getLogs({ address: ${short(ARC.systemEmitter)}, topics: [Transfer, *, ${short(pigeonhole)}], fromBlock: ${fromBlock} })`;
  app().innerHTML = `
    <a class="muted" href="#/">← new invoice</a>
    <h1>Invoice <code>${esc(id)}</code></h1>
    <div class="split">
      <div class="card">
        <div class="row" style="justify-content:space-between"><span class="muted">Deposit address</span><span id="st">${badge("UNPAID")}</span></div>
        <div class="addr" style="margin-top:8px">${pigeonhole} ${copyBtn(pigeonhole)}</div>
        <div id="qr" class="qr" style="margin-top:14px"></div>
        <div class="row" style="margin-top:14px">
          <button id="pay">Pay with wallet${amtStr ? ` (${esc(amtStr)} USDC)` : ""}</button>
          <button id="sweep" class="ghost" disabled>Sweep → treasury</button>
        </div>
        <p class="hint">Or send USDC to the address from any wallet on Arc. ${amtStr ? `Asked: <b>${esc(amtStr)} USDC</b>.` : ""}</p>
        <div id="msg" class="hint"></div>
      </div>
      <div class="card">
        <div class="kv">
          <span class="k">Salt</span><span class="mono">${short(salt)}</span>
          <span class="k">Predicted</span><span class="mono">offline == on-chain</span>
          <span class="k">Treasury</span><span class="mono"><a href="${addrUrl(TREASURY)}" target="_blank" rel="noopener">${short(TREASURY)} ↗</a></span>
          <span class="k">Paid in</span><span class="mono" id="paidin">—</span>
          <span class="k">Unswept</span><span class="mono" id="unswept">—</span>
          <span class="k">I2 · Σlogs == balance</span><span class="mono" id="i2">—</span>
        </div>
        <h2>Live log filter</h2>
        <div class="filter">${esc(filter)}</div>
        <h2>Movements</h2>
        <div id="moves"><p class="muted">Watching the system emitter…</p></div>
      </div>
    </div>`;
  QRCode.toCanvas(pigeonhole, { width: 180, margin: 1 }).then((c: HTMLCanvasElement) => document.getElementById("qr")!.appendChild(c)).catch(() => {});

  async function refresh() {
    let s: InvoiceState & { balance: bigint; i2: boolean };
    try { s = await invoiceState(pigeonhole, amount18, fromBlock); }
    catch (e: any) { document.getElementById("moves")!.innerHTML = `<p class="err">RPC error: ${esc(e.shortMessage || e.message || String(e))} — retrying…</p>`; return; }
    document.getElementById("st")!.innerHTML = badge(s.status);
    (document.getElementById("sweep") as HTMLButtonElement).disabled = s.unswept === 0n; // nothing to sweep (spec: disabled at 0 unswept)
    document.getElementById("paidin")!.textContent = `${fmtUsdc18(s.paidIn)} USDC`;
    document.getElementById("unswept")!.textContent = `${fmtUsdc18(s.unswept)} USDC`;
    document.getElementById("i2")!.innerHTML = s.i2 ? `<span class="ok">holds</span> (eth_getBalance ${fmtUsdc18(s.balance)})` : `<span class="err">mismatch</span> — balance ${fmtUsdc18(s.balance)} USDC, rescanning`;
    const rows = [...s.payments.map((m) => ["in", m]), ...s.sweeps.map((m) => ["out", m])] as ["in" | "out", typeof s.payments[0]][];
    rows.sort((a, b) => (a[1].block === b[1].block ? a[1].logIndex - b[1].logIndex : a[1].block < b[1].block ? -1 : 1));
    document.getElementById("moves")!.innerHTML = rows.length ? `<table><thead><tr><th>dir</th><th>value</th><th>block</th><th>tx</th></tr></thead><tbody>${
      rows.map(([d, m]) => `<tr><td>${d === "in" ? "↓ pay" : "↑ sweep"}</td><td class="mono">${fmtUsdc18(m.value)}</td><td class="mono">${m.block}</td><td><a href="${txUrl(m.tx)}" target="_blank" rel="noopener">${short(m.tx)} ↗</a></td></tr>`).join("")
    }</tbody></table>` : `<p class="muted">No payments yet.</p>`;
  }
  await refresh();
  const iv = setInterval(refresh, 3000);
  window.addEventListener("hashchange", () => clearInterval(iv), { once: true });

  document.getElementById("pay")!.onclick = async () => {
    const msg = document.getElementById("msg")!;
    try {
      const { address, provider } = await connectWallet();
      const value = amount18 ?? 10n ** 16n; // default 0.01 if no amount asked
      const hash = (await provider.request({ method: "eth_sendTransaction", params: [{ from: address, to: pigeonhole, value: `0x${value.toString(16)}` }] })) as string;
      msg.innerHTML = `Sent: <a href="${txUrl(hash)}" target="_blank" rel="noopener">${short(hash)} ↗</a> — waiting for the log…`;
      setTimeout(refresh, 1500);
    } catch (e: any) { msg.innerHTML = `<span class="err">${esc(e.message || String(e))}</span>`; }
  };
  document.getElementById("sweep")!.onclick = async () => {
    const msg = document.getElementById("msg")!;
    try {
      const { address, provider } = await connectWallet();
      const data = encodeFunctionData({ abi: factoryAbi, functionName: "sweep", args: [salt] });
      const hash = (await provider.request({ method: "eth_sendTransaction", params: [{ from: address, to: FACTORY, data }] })) as string; // wallet estimates the fee (the base fee floor is 20 Gwei; never pin it)
      msg.innerHTML = `Sweeping: <a href="${txUrl(hash)}" target="_blank" rel="noopener">${short(hash)} ↗</a>`;
      setTimeout(refresh, 1500);
    } catch (e: any) { msg.innerHTML = `<span class="err">${esc(e.message || String(e))}</span>`; }
  };
}

// ---------- Treasury / log view ----------
async function viewTreasury() {
  app().innerHTML = `<h1>Treasury view</h1>
    <p class="muted">Every sweep to <code><a href="${addrUrl(TREASURY)}" target="_blank" rel="noopener">${short(TREASURY)} ↗</a></code>, read from the factory's <code>Swept</code> events. No database.</p>
    <div class="card"><div id="tbl"><p class="muted">Reading Swept events…</p></div></div>
    <div class="card"><h2>Invoices this browser created</h2><div id="mine"></div></div>`;
  const mine = load();
  document.getElementById("mine")!.innerHTML = mine.length ? `<table><thead><tr><th>id</th><th>asked</th><th></th></tr></thead><tbody>${
    mine.map((m) => { const q = new URLSearchParams(); if (m.amount) q.set("amt", m.amount); if (m.from) q.set("from", m.from); return `<tr><td class="mono">${esc(m.id)}</td><td class="mono">${m.amount ? esc(m.amount) + " USDC" : "—"}</td><td><a href="#/i/${encodeURIComponent(m.id)}${q.toString() ? "?" + q : ""}">open</a></td></tr>`; }).join("")
  }</tbody></table>` : `<p class="muted">None yet — create one from “New invoice”.</p>`;
  try {
    const evs = await sweptEvents();
    document.getElementById("tbl")!.innerHTML = evs.length ? `<table><thead><tr><th>pigeonhole</th><th>amount</th><th>block</th><th>tx</th></tr></thead><tbody>${
      evs.slice().reverse().map((e: any) => `<tr><td class="mono">${short(e.args.pigeonhole)}</td><td class="mono">${fmtUsdc18(e.args.amount)} USDC</td><td class="mono">${e.blockNumber}</td><td><a href="${txUrl(e.transactionHash)}" target="_blank" rel="noopener">${short(e.transactionHash)} ↗</a></td></tr>`).join("")
    }</tbody></table>` : `<p class="muted">No sweeps yet.</p>`;
  } catch (e: any) { document.getElementById("tbl")!.innerHTML = `<p class="err">${esc(e.message || String(e))}</p>`; }
}

// ---------- Router ----------
function route() {
  const h = location.hash.slice(1) || "/";
  const [path, query] = h.split("?");
  const params = new URLSearchParams(query || "");
  if (path === "/" || path === "") return viewNew();
  if (path.startsWith("/i/")) return viewInvoice(decodeURIComponent(path.slice(3)), params.get("amt") || undefined, params.get("from") || undefined);
  if (path === "/treasury") return viewTreasury();
  return viewNew();
}
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.dataset.copy) { navigator.clipboard?.writeText(t.dataset.copy); t.textContent = "copied"; setTimeout(() => (t.textContent = "copy"), 1200); }
});
window.addEventListener("hashchange", route);
route();
