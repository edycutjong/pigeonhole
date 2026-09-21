import QRCode from "qrcode";
import { encodeFunctionData } from "viem";
import { predict, saltOf, fmtUsdc18, ARC, type InvoiceState } from "./lib/pigeonhole";
import { FACTORY, TREASURY, DEPLOY_BLOCK, pub, factoryAbi, invoiceState, sweptEvents, connectWallet, txUrl, addrUrl, onScanProgress, type LiveInvoiceState } from "./chain";

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
function copyBtn(text: string) { return `<span class="copy" role="button" tabindex="0" title="Copy address to the clipboard" aria-live="polite" data-copy="${esc(text)}">copy</span>`; }

// ---------- New invoice (the landing page) ----------
const DEMO_ID = "demo-paid"; // seeded first cycle on the production factory (deployments/arc-mainnet.json) — SWEPT forever
const DEMO_URL = `#/i/${DEMO_ID}?amt=0.02&from=${DEPLOY_BLOCK}`;
const REPO = "https://github.com/edycutjong/pigeonhole";
const ext = (href: string, label: string) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;

/** The living diagram: one 12 s CSS clock (styles.css `.mech`) drives the coin, the slot labels, the throwaway's birth and
 *  death, and the four captions under it. Transform/opacity only. Under prefers-reduced-motion it freezes mid-sweep. */
function mechanismSvg() {
  const demo = predict(FACTORY, TREASURY, saltOf(DEMO_ID));
  return `<svg viewBox="0 0 1200 380" role="img" aria-label="A throwaway contract is born at the codeless deposit address, sweeps its USDC into the treasury, and vanishes — the address is empty and reusable again." xmlns="http://www.w3.org/2000/svg">
    <defs>
      <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#4ea1ff"/></marker>
      <radialGradient id="cg"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".35" stop-color="#4ea1ff"/><stop offset="1" stop-color="#4ea1ff"/></radialGradient>
      <radialGradient id="cgk"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".35" stop-color="#3ddc84"/><stop offset="1" stop-color="#3ddc84"/></radialGradient>
    </defs>
    <!-- wallet -->
    <g class="sans">
      <rect x="60" y="110" width="210" height="110" rx="14" fill="rgba(255,255,255,.03)" stroke="#323b46" stroke-width="1.5"/>
      <text x="80" y="146" font-size="16" font-weight="600" fill="#e8edf2">any Arc wallet</text>
      <text x="80" y="170" font-size="12.5" fill="#8b97a6" class="mo">native send or ERC-20</text>
      <text x="80" y="190" font-size="12.5" fill="#8b97a6" class="mo">transfer() — both count</text>
    </g>
    <path class="an trail" d="M280 165 H408" stroke="#4ea1ff" stroke-width="2" fill="none" marker-end="url(#arr)" opacity="0"/>
    <text class="an cap-send mo" x="282" y="150" font-size="12.5" fill="#7cc0ff" opacity="0">sends USDC to the address →</text>
    <!-- the pigeonhole slot: an outline with a separate floor that opens during the sweep -->
    <text class="mo" x="420" y="72" font-size="12.5" fill="#8b97a6">the pigeonhole — invoice ${DEMO_ID} · no lock, no key</text>
    <path d="M436 230 a16 16 0 0 1 -16 -16 V106 a16 16 0 0 1 16 -16 h338 a16 16 0 0 1 16 16 V214 a16 16 0 0 1 -16 16" fill="rgba(78,161,255,.04)" stroke="#4ea1ff" stroke-width="3" stroke-linejoin="round" stroke-linecap="butt"/>
    <path class="an floor" d="M436 230 H774" stroke="#4ea1ff" stroke-width="3" stroke-linecap="butt"/>
    <!-- the throwaway contract: born (green outline) at 34 %, SELFDESTRUCT at 58 % -->
    <g class="an born" opacity="0" stroke="#3ddc84" stroke-width="10" stroke-opacity=".18" fill="none" stroke-linecap="butt">
      <path d="M436 230 a16 16 0 0 1 -16 -16 V106 a16 16 0 0 1 16 -16 h338 a16 16 0 0 1 16 16 V214 a16 16 0 0 1 -16 16"/>
      <path class="an floor" d="M436 230 H774"/>
    </g>
    <g class="an born" opacity="0" stroke="#3ddc84" stroke-width="3" fill="none" stroke-linecap="butt">
      <path d="M436 230 a16 16 0 0 1 -16 -16 V106 a16 16 0 0 1 16 -16 h338 a16 16 0 0 1 16 16 V214 a16 16 0 0 1 -16 16"/>
      <path class="an floor" d="M436 230 H774"/>
    </g>
    <g class="mo">
      <text x="500" y="128" font-size="16" fill="#e8edf2">${short(demo)}</text>
      <text class="an st-unpaid" x="500" y="158" font-size="14" font-weight="700" fill="#8b97a6">UNPAID</text>
      <text class="an st-paid" x="500" y="158" font-size="14" font-weight="700" fill="#7cc0ff" opacity="0">PAID · 0.02 USDC</text>
      <text class="an st-swept" x="500" y="158" font-size="14" font-weight="700" fill="#3ddc84" opacity="0">SWEPT · empty · reusable</text>
      <text class="an st-code" x="500" y="186" font-size="11.5" fill="#8b97a6">code 0x · nonce 0 · no key</text>
      <text class="an st-born" x="500" y="186" font-size="11.5" fill="#3ddc84" opacity="0">22 bytes · PUSH20 treasury; SELFDESTRUCT</text>
      <text x="500" y="212" font-size="11.5" fill="#8b97a6">CREATE2(factory, keccak256(id), treasury)</text>
    </g>
    <!-- the coin: at the wallet → into the slot → down into the treasury, turning green as it lands -->
    <g class="an coin" transform="translate(0,0)">
      <g class="an coin-a ease" opacity="0">
        <circle cx="235" cy="165" r="22" fill="#4ea1ff" opacity=".18"/>
        <circle class="an coin-green" cx="235" cy="165" r="15" fill="url(#cgk)" opacity="0"/>
        <circle class="an coin-blue" cx="235" cy="165" r="15" fill="url(#cg)"/>
        <text x="235" y="169" font-size="10" font-weight="700" fill="#04121f" text-anchor="middle" class="sans">$</text>
      </g>
    </g>
    <!-- right captions, one per beat -->
    <g class="an cap-pay" opacity="0">
      <text class="sans" x="820" y="124" font-size="17" font-weight="700" fill="#7cc0ff">PAID — read from one log</text>
      <text class="mo" x="820" y="150" font-size="13" fill="#c3ccd6">eth_getLogs · Transfer(from, to, value)</text>
      <text class="mo" x="820" y="170" font-size="13" fill="#c3ccd6">on the system emitter 0xffff…fffE</text>
      <text class="mo" x="820" y="190" font-size="13" fill="#8b97a6">no backend, no database, no indexer</text>
    </g>
    <g class="an cap-sweep" opacity="0">
      <text class="sans" x="820" y="124" font-size="17" font-weight="700" fill="#3ddc84">sweep(salt) — one transaction</text>
      <text class="mo" x="820" y="150" font-size="13" fill="#c3ccd6">a 22-byte contract is born at the address,</text>
      <text class="mo" x="820" y="170" font-size="13" fill="#c3ccd6">moves the balance, SELFDESTRUCTs to treasury</text>
      <text class="mo" x="820" y="190" font-size="13" fill="#8b97a6">64,162 gas ≈ $0.0013 · anyone may call it</text>
    </g>
    <g class="an cap-gone" opacity="0">
      <text class="sans" x="820" y="124" font-size="17" font-weight="700" fill="#e8edf2">Gone. Empty. Reusable.</text>
      <text class="mo" x="820" y="150" font-size="13" fill="#c3ccd6">EIP-6780 deleted the contract in the same tx</text>
      <text class="mo" x="820" y="170" font-size="13" fill="#c3ccd6">code 0x · nonce 0 — nothing was ever held</text>
      <text class="mo" x="820" y="190" font-size="13" fill="#8b97a6">pay and sweep the same address again, forever</text>
    </g>
    <!-- treasury bar -->
    <rect x="420" y="305" width="720" height="40" rx="12" fill="#3ddc84"/>
    <rect class="an bar-glow" x="420" y="305" width="720" height="40" rx="12" fill="#ffffff" opacity="0" fill-opacity=".35"/>
    <rect class="an bar-glow" x="414" y="299" width="732" height="52" rx="16" fill="none" stroke="#3ddc84" stroke-width="8" stroke-opacity=".25" opacity="0"/>
    <text class="mo" x="500" y="330" font-size="14" font-weight="700" fill="#04121f">treasury ${short(TREASURY)} — immutable · the only place funds can ever go</text>
    <text class="mo" x="420" y="372" font-size="12" fill="#8b97a6">only on Arc: USDC is the native balance — SELFDESTRUCT can move it, every send is a system-emitter log</text>
  </svg>`;
}

function viewNew() {
  const demo = predict(FACTORY, TREASURY, saltOf(DEMO_ID));
  const tx = (h: string, label: string) => ext(txUrl(h), `${label} ↗`);
  app().className = "landing";
  app().innerHTML = `
    <section class="hero">
      <div>
        <span class="live" id="hero-live"><i></i>Live on <b>Arc mainnet</b> · chain 5042</span>
        <h1>A USDC address per invoice — <span class="hl">with no key to guard.</span></h1>
        <p class="sub">Type an invoice id and get a fresh Arc deposit address that exists <b>before any contract does</b>.
        When it's paid, one permissionless transaction sweeps it to the treasury and the address vanishes —
        reusable forever, with no private key anywhere.</p>
        <div class="chips">
          <span class="chip"><span class="ok">0</span> keys held</span>
          <span class="chip"><b>$0.0013</b> per sweep · 64,162 gas</span>
          <span class="chip">no backend · state is <b>eth_getLogs</b></span>
        </div>
      </div>
      <div class="card create">
        <div class="head"><h2>New invoice</h2><span class="pill">no transaction · no key</span></div>
        <label for="id">Invoice id</label>
        <input id="id" placeholder="e.g. acme-2026-0042" autocomplete="off" spellcheck="false" />
        <label for="amt">Amount asked (USDC, optional)</label>
        <input id="amt" placeholder="e.g. 0.02" inputmode="decimal" autocomplete="off" />
        <button id="go">Create deposit address →</button>
        <p id="iderr" class="err hint" role="alert" hidden>Type an invoice id first — any string works; it becomes the CREATE2 salt.</p>
        <p class="hint">The address is <code>CREATE2(factory, keccak256(id), treasury)</code> — computed offline in your browser, verified on-chain. Nothing is deployed until it's swept.</p>
      </div>
    </section>

    <section class="section mech" aria-labelledby="how">
      <span class="eyebrow"><b>How it works</b> · one loop, the whole mechanism</span>
      <h2 id="how">Born, sweeps, gone — all inside one transaction.</h2>
      <p class="lede">The contract that moves the money exists for exactly one transaction, so there is never a key to steal.
      This is the seeded <code>${DEMO_ID}</code> invoice; everything below is what its address really went through.</p>
      <div class="frame">${mechanismSvg()}<div class="prog" aria-hidden="true"><i></i></div></div>
      <p class="scrollhint" aria-hidden="true">← the diagram scrolls sideways →</p>
      <ol class="steps4">
        <li><b><i>01</i>A codeless address</b><code>CREATE2(factory, keccak256(id), treasury)</code> — computed offline. No code, no key, no transaction to create it.</li>
        <li><b><i>02</i>USDC arrives → PAID</b>Any wallet sends USDC. The page reads one <code>eth_getLogs</code> on the system emitter. No backend, no database.</li>
        <li><b><i>03</i>One tx: born, sweep, self-destruct</b><code>sweep(salt)</code> deploys a 22-byte contract at that exact address; its constructor moves the whole balance to the treasury and <code>SELFDESTRUCT</code>s.</li>
        <li><b><i>04</i>Empty again, reusable</b>EIP-6780 deletes it in the same transaction: code <code>0x</code>, nonce 0. The same address can be paid and swept forever.</li>
      </ol>
    </section>

    <section class="section" aria-labelledby="proof-h">
      <span class="eyebrow"><b>Live proof</b> · read from Arc mainnet by this page, right now</span>
      <h2 id="proof-h">Every number here is an RPC call, not a claim.</h2>
      <p class="lede">The seeded <code>${DEMO_ID}</code> cycle was paid and swept on the production factory. Its address is codeless again —
      you can check each read against the explorer.</p>
      <div class="proof">
        <div class="stat"><span class="tag live" id="lp-bal-tag"><i class="dot"></i>eth_getBalance</span><div><div class="v" id="lp-bal">—</div><div class="s">${DEMO_ID} → ${short(demo)} · paid 0.02 USDC, swept in ${ext(txUrl("0xe639255a52b96c7f4733608776f6cd11eca3c615748350877d2ea384a6988ea6"), "0xe639…8ea6 ↗")} · <a href="${DEMO_URL}">open the invoice →</a></div></div></div>
        <a class="stat" href="${addrUrl(demo)}" target="_blank" rel="noopener"><span class="tag">eth_getCode · nonce</span><div><div class="v" id="lp-code">—</div><div class="s">the address after its sweep: nothing to steal, nothing to guard · explorer ↗</div></div></a>
        <a class="stat" href="${addrUrl(FACTORY)}" target="_blank" rel="noopener"><span class="tag">eth_call predict()</span><div><div class="v" id="lp-pred">—</div><div class="s">factory ${short(FACTORY)} · offline formula vs on-chain ↗</div></div></a>
        <div class="stat"><span class="tag live" id="lp-head-tag"><i class="dot"></i>eth_blockNumber</span><div><div class="v acc" id="lp-head">—</div><div class="s">Arc mainnet · chain 5042 · deterministic finality</div></div></div>
      </div>
    </section>

    <section class="section" aria-labelledby="why">
      <span class="eyebrow"><b>Why only on Arc</b> · the sponsor-removal test</span>
      <h2 id="why">The same 22 bytes do nothing on any other EVM chain.</h2>
      <p class="lede">CREATE2 + constructor-<code>SELFDESTRUCT</code> is the classic Ethereum <em>ETH</em>-deposit pattern. Arc is the chain where it works for <b>USDC</b>.</p>
      <div class="cmp">
        <div class="col"><h3>Any other EVM chain</h3><ul>
          <li><span class="no">✕</span><div><span class="k">USDC</span>An ERC-20 balance that lives inside the token contract.</div></li>
          <li><span class="no">✕</span><div><span class="k">SELFDESTRUCT</span>Moves only the native asset. It cannot touch a token balance — the sweep moves nothing.</div></li>
          <li><span class="no">✕</span><div><span class="k">Collecting</span>Needs that address's own private key to sign a <code>transfer()</code> — one HD-derived key per customer, kept online.</div></li>
          <li><span class="no">✕</span><div><span class="k">Gas</span>A second asset (ETH) on every deposit address just to move the first.</div></li>
        </ul><div class="verdict">Result: a key-management service, a sweep signer, an indexer, and a gas token.</div></div>
        <div class="col arc"><h3>Arc</h3><ul>
          <li><span class="yes">✓</span><div><span class="k">USDC</span>The native balance of every account — a codeless address holds it.</div></li>
          <li><span class="yes">✓</span><div><span class="k">SELFDESTRUCT</span>Allowed, including during deployment — it moves the whole native USDC balance to the treasury.</div></li>
          <li><span class="yes">✓</span><div><span class="k">Collecting</span>Anyone calls <code>sweep(salt)</code>. No key exists; funds can only ever reach the immutable treasury.</div></li>
          <li><span class="yes">✓</span><div><span class="k">PAID</span>EIP-7708: every native send is a <code>Transfer</code> log from the system emitter <code>0xffff…fffE</code> — one <code>eth_getLogs</code>.</div></li>
        </ul><div class="verdict">Result: one 61-line contract, one static page, one transaction per sweep, zero keys.</div></div>
      </div>
    </section>

    <section class="section" aria-labelledby="rec">
      <span class="eyebrow"><b>Receipts</b> · all on Arc mainnet, chain 5042</span>
      <h2 id="rec">Measured, tested, and linked — not promised.</h2>
      <p class="lede">The benchmark is N=25 balance-moving sweeps on the production factory; the receipts are the seeded cycles and the edge cases.</p>
      <div class="receipts">
        <div class="card"><h3>Mainnet receipts</h3><ul class="rlist">
          <li><span>Pay <code>${DEMO_ID}</code> — 0.02 USDC native send to the codeless address</span>${tx("0x5fdef1b0d140e493152a26ed361d3c185b024987987cf79e0de79becc9dad59f", "0x5fdef1b0…")}</li>
          <li><span>Sweep it — 64,162 gas ≈ $0.0013, <code>Transfer(pigeonhole → treasury)</code> + <code>Swept</code></span>${tx("0xe639255a52b96c7f4733608776f6cd11eca3c615748350877d2ea384a6988ea6", "0xe639255a…")}</li>
          <li><span>Pay a codeless predicted address (native send) · day-0 probe factory</span>${tx("0xc80df1360ab2cd4851b998d323840f6bfee1317a61fd0bfea48856ff711bfbd3", "0xc80df136…")}</li>
          <li><span>Pay via ERC-20 <code>transfer()</code> — two logs, the page counts one</span>${tx("0x64ce87be84ef57938c0af91b7c6a89c9eb736ff3a8627dbf2c4f1a069a936a64", "0x64ce87be…")}</li>
          <li><span>Its sweep — the same 64,162 gas</span>${tx("0xf5883aeae9a0c872241de57b348ebe688bf6f80b58542f7d5166bfc24b5f8111", "0xf5883aea…")}</li>
          <li><span>Re-pay an already-swept address (later tx) · probe factory</span>${tx("0x531f09ffacdd006cb7c3f5c009e665ca62331c03cc867ebf5bdef2ef7cd6a76c", "0x531f09ff…")}</li>
          <li><span>Re-sweep it — 64,140 gas (the probe factory's bytecode)</span>${tx("0x631814adf42ce99763ac5ca53859e0b0f677538707a6246a23843bb4e83fef51", "0x631814ad…")}</li>
        </ul></div>
        <div class="card"><h3>Numbers</h3><div class="numbers">
          <div class="stat"><div class="v">64,162</div><div class="l">gas per sweep · p50, N=25</div></div>
          <div class="stat"><div class="v">≈ $0.0013</div><div class="l">per sweep · at the measured p50 gas price</div></div>
          <div class="stat"><div class="v">37</div><div class="l">tests · 12 Foundry + 25 vitest</div></div>
          <div class="stat"><div class="v">20,000</div><div class="l">property cases · fast-check</div></div>
          <div class="stat"><div class="v">34</div><div class="l">E2E checks · desktop + mobile</div></div>
          <div class="stat"><div class="v">0</div><div class="l">keys held · 0 backends</div></div>
        </div><p class="hint" style="margin-top:14px">${ext(`${REPO}/blob/main/bench/results.json`, "bench/results.json ↗")} · ${ext(`${REPO}/blob/main/DEMO.md`, "DEMO.md ↗")} · <a href="#/judge">Reviewer page →</a></p></div>
      </div>
    </section>

    <section class="section" aria-labelledby="lim">
      <span class="eyebrow"><b>Honest limitations</b></span>
      <h2 id="lim">What it does not do yet.</h2>
      <p class="lede">Kept here rather than edited away.</p>
      <ul class="limits">
        <li>The immutable treasury is also a <b>single point of failure</b>: if it were ever blocklisted, unswept invoices freeze until a new factory is deployed.</li>
        <li>The static page needs an <b>anonymous Arc RPC</b> and scans logs in 9,000-block chunks — an invoice URL without <code>?from=</code> scans from the deploy block and gets slower every day; the treasury view always does.</li>
        <li><b>PAID latency is not benchmarked.</b> <code>sweepMany</code> is on-chain and tested, but the page calls <code>sweep</code> only — no per-invoice unswept totals or <em>Sweep all</em> in the treasury view.</li>
        <li>The <code>?amt=</code> amount is the merchant's claim — the chain proves what was <em>paid</em>.</li>
      </ul>
    </section>

    <div class="cta">
      <div><h2>Review it in 60 seconds.</h2><p>One Arc wallet, ≤ $0.10. Or read the receipts with no wallet at all — the reviewer page has the path, the numbers and the limitations.</p></div>
      <div class="row"><a class="btn primary" href="#/judge">Reviewer page →</a><a class="btn ghost" href="${REPO}" target="_blank" rel="noopener">Repository ↗</a></div>
    </div>`;
  const go = async () => {
    const idEl = document.getElementById("id") as HTMLInputElement;
    const id = idEl.value.trim();
    const amt = (document.getElementById("amt") as HTMLInputElement).value.trim();
    if (!id) { (document.getElementById("iderr") as HTMLElement).hidden = false; idEl.setAttribute("aria-invalid", "true"); idEl.focus(); return; }
    // Record the creation block in the URL so the invoice view scans from here, not from the factory's deploy block
    // (the RPC caps eth_getLogs at 10k blocks per call; the chain adds ~170k blocks a day).
    const from = await pub.getBlockNumber().catch(() => DEPLOY_BLOCK);
    remember({ id, amount: amt || undefined, from: from.toString() });
    const saved = load().find((s) => s.id === id)?.from; // an id created before keeps its original window
    const q = new URLSearchParams(); if (amt) q.set("amt", amt); q.set("from", saved ?? from.toString());
    location.hash = `#/i/${encodeURIComponent(id)}?${q}`;
  };
  const frame = document.querySelector<HTMLElement>(".mech .frame");
  if (frame && matchMedia("(max-width: 760px)").matches) frame.scrollLeft = 300; // phones: open on the slot, not the wallet
  document.getElementById("go")!.onclick = go;
  for (const f of ["id", "amt"]) (document.getElementById(f) as HTMLInputElement).addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  (document.getElementById("id") as HTMLInputElement).addEventListener("input", (e) => { (document.getElementById("iderr") as HTMLElement).hidden = true; (e.target as HTMLInputElement).removeAttribute("aria-invalid"); });
  liveProof(demo);
}

/** Cheap single reads for the proof strip (no log scans): code, nonce and balance of the seeded address, the factory's
 *  own predict() against the offline formula, and the chain head polled every 8 s until the route changes. Every read
 *  fails soft — the tiles keep their "—". */
function liveProof(demo: `0x${string}`) {
  const set = (id: string, html: string) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const salt = saltOf(DEMO_ID);
  const done = { code: false, bal: false, pred: false };
  const reads = () => Promise.allSettled([
    done.code ? Promise.reject() : Promise.all([pub.getCode({ address: demo }), pub.getTransactionCount({ address: demo })]),
    done.bal ? Promise.reject() : pub.getBalance({ address: demo }),
    done.pred ? Promise.reject() : pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "predict", args: [salt] }),
  ]).then(([cn, bal, pred]) => {
    const allDown = [cn, bal, pred].every((r) => r.status === "rejected") && !done.code && !done.bal && !done.pred;
    for (const id of ["hero-live", "lp-bal-tag", "lp-head-tag"]) document.getElementById(id)?.classList.toggle("off", allDown);
    const hero = document.getElementById("hero-live");
    if (hero) hero.innerHTML = allDown ? "<i></i>Arc mainnet · chain 5042 — <b>RPC unavailable</b> right now, retrying" : "<i></i>Live on <b>Arc mainnet</b> · chain 5042";
    if (cn.status === "fulfilled") { done.code = true; set("lp-code", `${cn.value[0] ?? "0x"} · nonce ${cn.value[1]}`); } else if (!done.code) set("lp-code", `<small>RPC unavailable · retrying</small>`);
    if (bal.status === "fulfilled") { done.bal = true; set("lp-bal", `${fmtUsdc18(bal.value)}<small>USDC now</small>`); } else if (!done.bal) set("lp-bal", `<small>RPC unavailable · retrying</small>`);
    if (pred.status === "fulfilled") { done.pred = true; set("lp-pred", pred.value.toLowerCase() === demo.toLowerCase() ? `<span class="ok">✓</span> ${short(pred.value)}` : `<span class="err">≠</span> ${short(pred.value)}`); } else if (!done.pred) set("lp-pred", `<small>RPC unavailable · retrying</small>`);
  });
  reads();
  const head = () => { pub.getBlockNumber().then((n) => set("lp-head", `#${n.toLocaleString("en-US")}`)).catch(() => {}); if (!(done.code && done.bal && done.pred)) reads(); };
  const iv = setInterval(head, 8000);
  pub.getBlockNumber().then((n) => set("lp-head", `#${n.toLocaleString("en-US")}`)).catch(() => {});
  window.addEventListener("hashchange", () => clearInterval(iv), { once: true });
}

// ---------- Invoice detail ----------
async function viewInvoice(id: string, amtStr?: string, fromStr?: string) {
  const salt = saltOf(id);
  const pigeonhole = predict(FACTORY, TREASURY, salt);
  if (amtStr && !/^\d+(\.\d{1,6})?$/.test(amtStr)) amtStr = undefined; // ignore a malformed ?amt= instead of throwing
  const amount18 = amtStr ? BigInt(Math.round(parseFloat(amtStr) * 1e6)) * 10n ** 12n : undefined;
  const fromBlock = fromStr && /^\d+$/.test(fromStr) ? BigInt(fromStr) : (load().find((s) => s.id === id)?.from ? BigInt(load().find((s) => s.id === id)!.from!) : DEPLOY_BLOCK);
  const filter = `eth_getLogs({ address: ${short(ARC.systemEmitter)}, topics: [Transfer, *, ${short(pigeonhole)}], fromBlock: ${fromBlock} })`;
  app().className = "";
  app().innerHTML = `
    <a class="back" href="#/">← New invoice</a>
    <div class="titlebar"><h1>Invoice <code>${esc(id)}</code></h1><span id="st">${badge("UNPAID")}</span><span id="stale" class="stale">not yet read from chain…</span></div>
    <div class="split inv">
      <div class="card">
        <div class="head"><span class="k">Deposit address</span><span class="muted mono" style="font-size:12px">Arc mainnet · 5042</span></div>
        <div class="addr">${pigeonhole} ${copyBtn(pigeonhole)} <a class="xl" href="${addrUrl(pigeonhole)}" target="_blank" rel="noopener">explorer ↗</a></div>
        <div class="qrrow">
          <div id="qr" class="qr" style="width:188px;height:188px"></div>
          <div class="actions">
            <button id="pay">Pay with wallet (${amtStr ? esc(amtStr) : "0.01"} USDC)</button>
            <button id="sweep" class="ghost" disabled>Sweep → treasury</button>
            <p class="hint">Or send USDC to the address from any wallet on Arc — native send or ERC-20 <code>transfer()</code>. ${amtStr ? `Asked: <b>${esc(amtStr)} USDC</b>.` : ""}</p>
            <div id="msg" class="hint"></div>
          </div>
        </div>
        <p class="hint" style="margin-top:14px">No transaction created this address and no key exists for it. <b>Sweep</b> is permissionless: anyone may call it, and funds can only reach the treasury.</p>
      </div>
      <div class="card">
        <h2>Ledger · from <code>eth_getLogs</code> only</h2>
        <div class="kv">
          <span class="k">Salt</span><span class="mono">${short(salt)}</span>
          <span class="k">Predicted</span><span class="mono" id="pred">offline formula · checking on-chain <code>predict()</code>…</span>
          <span class="k">Treasury</span><span class="mono"><a href="${addrUrl(TREASURY)}" target="_blank" rel="noopener">${short(TREASURY)} ↗</a></span>
          <span class="k">Paid in</span><span class="mono" id="paidin">—</span>
          <span class="k">Unswept</span><span class="mono" id="unswept">—</span>
          <span class="k">I2 · Σlogs == balance</span><span class="mono" id="i2">—</span>
        </div>
        <h2>Movements</h2>
        <div id="moves"><p class="muted">Watching the system emitter…</p></div>
        <h2>Live log filter</h2>
        <div class="filter">${esc(filter)}</div>
      </div>
    </div>`;
  QRCode.toCanvas(pigeonhole, { width: 168, margin: 1 }).then((c: HTMLCanvasElement) => document.getElementById("qr")!.appendChild(c)).catch(() => {});

  // One read-only call: the factory's own predict(salt) must equal the offline formula (the address above). Fails soft.
  pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "predict", args: [salt] })
    .then((a) => { document.getElementById("pred")!.innerHTML = a.toLowerCase() === pigeonhole.toLowerCase() ? `<span class="ok">✓</span> on-chain <code>predict()</code> == offline formula` : `<span class="err">≠</span> on-chain predict() returned ${short(a)}`; })
    .catch(() => { const el = document.getElementById("pred"); if (el) el.innerHTML = `offline formula · on-chain check unavailable (RPC)`; });
  let verified = false;
  let gone = false; // set when the route changes; declared here so refresh() can see it
  // First read of an old invoice walks its whole history at the RPC's pace (~3 getLogs/s): say so, with a count.
  const offProgress = onScanProgress((addr, p) => {
    if (verified || gone || addr.toLowerCase() !== pigeonhole.toLowerCase() || p.total < 2) return;
    const el = document.getElementById("moves"); if (el) el.innerHTML = `<p class="muted">Reading history from the system emitter · chunk ${p.done} / ${p.total} · to block ${p.toBlock}</p>`;
  });
  async function refresh() {
    let s: LiveInvoiceState;
    const stale = document.getElementById("stale");
    try { s = await invoiceState(pigeonhole, amount18, fromBlock); }
    catch (e: any) {
      if (gone || !document.getElementById("moves")) return;
      document.getElementById("moves")!.innerHTML = `<p class="err">RPC error: ${esc(e.shortMessage || e.message || String(e))} — retrying…</p>`;
      if (stale && !verified) stale.textContent = "state not yet read from chain — RPC error, retrying…";
      return;
    }
    if (gone || !document.getElementById("st")) return; // the route changed while the scan was in flight
    verified = true; if (stale) stale.textContent = "";
    document.getElementById("st")!.innerHTML = badge(s.status);
    (document.getElementById("sweep") as HTMLButtonElement).disabled = s.unswept === 0n; // nothing to sweep (spec: disabled at 0 unswept)
    document.getElementById("paidin")!.textContent = `${fmtUsdc18(s.paidIn)} USDC`;
    document.getElementById("unswept")!.textContent = `${fmtUsdc18(s.unswept)} USDC`;
    document.getElementById("i2")!.innerHTML = s.i2 ? `<span class="ok">holds</span> (eth_getBalance ${fmtUsdc18(s.balance)})${s.rescanned ? " · window widened" : ""}` : `<span class="err">mismatch</span> — Σlogs ${fmtUsdc18(s.unswept)} vs balance ${fmtUsdc18(s.balance)} USDC, re-checking next poll`;
    const rows = [...s.payments.map((m) => ["in", m]), ...s.sweeps.map((m) => ["out", m])] as ["in" | "out", typeof s.payments[0]][];
    rows.sort((a, b) => (a[1].block === b[1].block ? a[1].logIndex - b[1].logIndex : a[1].block < b[1].block ? -1 : 1));
    document.getElementById("moves")!.innerHTML = rows.length ? `<table><thead><tr><th>dir</th><th>value</th><th>block</th><th>tx</th></tr></thead><tbody>${
      rows.map(([d, m]) => `<tr><td>${d === "in" ? "↓ pay" : "↑ sweep"}</td><td class="mono">${fmtUsdc18(m.value)}</td><td class="mono">${m.block}</td><td><a href="${txUrl(m.tx)}" target="_blank" rel="noopener">${short(m.tx)} ↗</a></td></tr>`).join("")
    }</tbody></table>` : `<p class="muted">No payments yet.</p>`;
  }
  // Register the cleanup BEFORE the first (possibly slow) scan: leaving the route must never leave a poller behind.
  let iv: ReturnType<typeof setInterval> | undefined;
  window.addEventListener("hashchange", () => { gone = true; offProgress(); if (iv !== undefined) clearInterval(iv); }, { once: true });
  const tick = async () => { if (gone) return; await refresh(); };
  await tick();
  if (!gone) iv = setInterval(tick, 5000); // 2 getLogs per poll; ≈0.4 calls/s stays under the public RPC's ≈0.5/s

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
  app().className = "";
  app().innerHTML = `
    <div class="titlebar"><h1>Treasury</h1><span class="live" id="tr-live"><i></i>read live from <b>Swept</b> events</span></div>
    <p class="muted" style="margin-bottom:18px;max-width:64ch">Every sweep to <code><a href="${addrUrl(TREASURY)}" target="_blank" rel="noopener">${short(TREASURY)} ↗</a></code>, read from the factory's <code>Swept</code> events on Arc mainnet. No database — the chain is the ledger.</p>
    <div class="stat-row">
      <div class="stat"><div class="v" id="tr-count">—</div><div class="l">sweeps</div></div>
      <div class="stat"><div class="v ok" id="tr-total">—</div><div class="l">USDC swept to the treasury</div></div>
      <div class="stat"><div class="v" id="tr-last">—</div><div class="l">latest sweep · block</div></div>
    </div>
    <div class="card"><h2>Sweeps</h2><div id="tbl"><p class="muted">Reading Swept events from block ${DEPLOY_BLOCK} in 9,000-block chunks…</p></div></div>
    <div class="card"><h2>Invoices this browser created</h2><div id="mine"></div></div>`;
  const mine = load();
  document.getElementById("mine")!.innerHTML = mine.length ? `<table><thead><tr><th>id</th><th>asked</th><th></th></tr></thead><tbody>${
    mine.map((m) => { const q = new URLSearchParams(); if (m.amount) q.set("amt", m.amount); if (m.from) q.set("from", m.from); return `<tr><td class="mono">${esc(m.id)}</td><td class="mono">${m.amount ? esc(m.amount) + " USDC" : "—"}</td><td><a href="#/i/${encodeURIComponent(m.id)}${q.toString() ? "?" + q : ""}">open →</a></td></tr>`; }).join("")
  }</tbody></table>` : `<p class="muted">None yet — create one from <a href="#/">New invoice</a>.</p>`;
  try {
    const evs = await sweptEvents();
    const total = evs.reduce((acc: bigint, e: any) => acc + (e.args.amount as bigint), 0n);
    const set = (id: string, t: string) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    set("tr-count", String(evs.length)); set("tr-total", fmtUsdc18(total)); set("tr-last", evs.length ? String(evs[evs.length - 1].blockNumber) : "—");
    document.getElementById("tbl")!.innerHTML = evs.length ? `<table><thead><tr><th>pigeonhole</th><th>amount</th><th>block</th><th>tx</th></tr></thead><tbody>${
      evs.slice().reverse().map((e: any) => `<tr><td class="mono">${short(e.args.pigeonhole)}</td><td class="mono">${fmtUsdc18(e.args.amount)} USDC</td><td class="mono">${e.blockNumber}</td><td><a href="${txUrl(e.transactionHash)}" target="_blank" rel="noopener">${short(e.transactionHash)} ↗</a></td></tr>`).join("")
    }</tbody></table>` : `<p class="muted">No sweeps yet.</p>`;
  } catch (e: any) {
    document.getElementById("tbl")!.innerHTML = `<p class="err">RPC error: ${esc(e.shortMessage || e.message || String(e))}</p><p class="row" style="margin-top:12px"><button id="tr-retry" class="ghost">Retry the scan</button></p>`;
    const live = document.getElementById("tr-live"); if (live) { live.className = "live off"; live.innerHTML = "<i></i>RPC unavailable — not live"; }
    document.getElementById("tr-retry")!.onclick = () => viewTreasury();
  }
}

// ---------- Judge / reviewer page (no auth, no wallet, no RPC needed to render) ----------
export const CLAIM = "A fresh USDC deposit address per invoice, no key to guard, swept in one transaction. Live on Arc mainnet.";
function viewJudge() {
  const tx = (h: string, label: string) => `<a href="${txUrl(h)}" target="_blank" rel="noopener">${label} ↗</a>`;
  app().className = "judge";
  app().innerHTML = `
    <section class="hero"><div><span class="eyebrow"><b>Reviewer page</b> · no auth, no wallet, no RPC needed to render</span><h1>For reviewers</h1><p id="claim">${CLAIM}</p></div></section>
    <div class="stat-row">
      <div class="stat"><div class="v">64,162</div><div class="l">gas per sweep · p50 · N=25</div></div>
      <div class="stat"><div class="v">≈ $0.0013</div><div class="l">per sweep · measured p50 gas price</div></div>
      <div class="stat"><div class="v">37 + 20,000</div><div class="l">tests + property cases</div></div>
      <div class="stat"><div class="v">34</div><div class="l">E2E checks · read-only vs mainnet</div></div>
    </div>
    <div class="split">
      <div class="card">
        <h2>The 60-second path (one Arc wallet, ≤ $0.10)</h2>
        <ol class="steps">
          <li><a href="#/">New invoice</a> → type any id and <code>0.02</code> → <b>Create deposit address</b>. No transaction; the address is CREATE2 arithmetic.</li>
          <li>Open that address on <a href="${ARC.explorer}" target="_blank" rel="noopener">explorer.arc.io ↗</a> (the invoice page links it): an empty account, no code, nonce 0.</li>
          <li><b>Pay with wallet</b> (or send 0.02 USDC from any Arc wallet). The badge flips <b>PAID</b> on the next 3-second poll — one <code>eth_getLogs</code> on the system emitter, no backend.</li>
          <li><b>Sweep → treasury</b>. One transaction (~$0.0013): the throwaway is born at that address, moves the balance, and is deleted in the same tx.</li>
          <li><a href="#/treasury">Treasury</a> lists the sweep from the factory's <code>Swept</code> events.</li>
        </ol>
        <h2>No wallet? Read the receipts</h2>
        <ul class="steps">
          <li>Pay <code>demo-paid</code> (0.02 USDC, native send) → ${tx("0x5fdef1b0d140e493152a26ed361d3c185b024987987cf79e0de79becc9dad59f", "0x5fdef1b0…")} · its sweep, 64,162 gas ≈ $0.0013 → ${tx("0xe639255a52b96c7f4733608776f6cd11eca3c615748350877d2ea384a6988ea6", "0xe639255a…")}</li>
          <li>Pay a codeless address, day-0 probe factory → ${tx("0xc80df1360ab2cd4851b998d323840f6bfee1317a61fd0bfea48856ff711bfbd3", "0xc80df136…")}</li>
          <li>Pay via ERC-20 <code>transfer()</code> → ${tx("0x64ce87be84ef57938c0af91b7c6a89c9eb736ff3a8627dbf2c4f1a069a936a64", "0x64ce87be…")} · its sweep → ${tx("0xf5883aeae9a0c872241de57b348ebe688bf6f80b58542f7d5166bfc24b5f8111", "0xf5883aea…")}</li>
          <li>Re-pay a swept address (later tx, probe factory) → ${tx("0x531f09ffacdd006cb7c3f5c009e665ca62331c03cc867ebf5bdef2ef7cd6a76c", "0x531f09ff…")} · re-sweep, 64,140 gas → ${tx("0x631814adf42ce99763ac5ca53859e0b0f677538707a6246a23843bb4e83fef51", "0x631814ad…")}</li>
        </ul>
      </div>
      <div class="card">
        <h2>Receipt block</h2>
        <div class="kv">
          <span class="k">Chain</span><span class="mono">Arc mainnet · 5042</span>
          <span class="k">Factory</span><span class="mono"><a href="${addrUrl(FACTORY)}" target="_blank" rel="noopener">${short(FACTORY)} ↗</a></span>
          <span class="k">Treasury</span><span class="mono"><a href="${addrUrl(TREASURY)}" target="_blank" rel="noopener">${short(TREASURY)} ↗</a></span>
          <span class="k">Sweep gas</span><span class="mono">64,162 p50 · N=25 · ≈ $0.0013</span>
          <span class="k">Tests</span><span class="mono">37 (12 Foundry + 25 vitest)</span>
          <span class="k">Property cases</span><span class="mono">20,000 (fast-check, 4 properties)</span>
          <span class="k">Backend</span><span class="mono">none — eth_getLogs only</span>
          <span class="k">Keys held</span><span class="mono">0</span>
        </div>
        <h2>Reproduce (read-only, no wallet)</h2>
        <div class="filter">npm install &amp;&amp; npm run verify &amp;&amp; npm test
git submodule update --init &amp;&amp; forge test --root contracts</div>
        <h2>Honest limitations</h2>
        <ul class="steps">
          <li>The immutable treasury is a single point of failure: if it were blocklisted, unswept invoices freeze until a new factory.</li>
          <li>The page needs an anonymous Arc RPC and scans logs in 9,000-block chunks, paced to that RPC's ≈0.5 calls/s — the first read of an old invoice takes minutes (progress is shown; the walk is checkpointed in the browser and never repeated). The seeded <code>demo-paid</code> / <code>demo-erc20</code> ship a committed history checkpoint (<code>deployments/history-checkpoints.json</code>, every movement re-checked by <code>npm run verify</code>) so they open fast.</li>
          <li>PAID latency is not benchmarked; <code>sweepMany</code> is on-chain and tested but the page calls <code>sweep</code> only.</li>
          <li>The <code>?amt=</code> is the merchant's claim — the chain proves what was <em>paid</em>.</li>
        </ul>
        <p class="hint"><a href="https://github.com/edycutjong/pigeonhole" target="_blank" rel="noopener">Repository ↗</a> · <a href="https://github.com/edycutjong/pigeonhole/blob/main/DEMO.md" target="_blank" rel="noopener">DEMO.md ↗</a> · <a href="https://github.com/edycutjong/pigeonhole/blob/main/ARCHITECTURE.md" target="_blank" rel="noopener">ARCHITECTURE.md ↗</a></p>
      </div>
    </div>`;
}

// ---------- Router ----------
function route() {
  const h = location.hash.slice(1) || "/";
  const [path, query] = h.split("?");
  const params = new URLSearchParams(query || "");
  document.querySelectorAll<HTMLAnchorElement>("header.topbar nav a").forEach((a) => {
    const href = a.getAttribute("href") || "";
    const current = href === "#/" ? path === "/" || path === "" || path.startsWith("/i/") : href === `#${path}`;
    if (current) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const title = (t: string) => { document.title = t ? `${t} · Pigeonhole` : "Pigeonhole — keyless USDC deposit addresses on Arc"; };
  title(path.startsWith("/i/") ? `Invoice ${decodeURIComponent(path.slice(3))}` : path === "/treasury" ? "Treasury" : path === "/judge" ? "For reviewers" : "");
  if (path === "/" || path === "") return viewNew();
  if (path.startsWith("/i/")) { const id = decodeURIComponent(path.slice(3)).trim(); if (!id) { location.hash = "#/"; return; } return viewInvoice(id, params.get("amt") || undefined, params.get("from") || undefined); }
  if (path === "/treasury") return viewTreasury();
  if (path === "/judge") return viewJudge();
  location.hash = "#/"; // unknown route: go home (hashchange re-routes)
}
const doCopy = async (t: HTMLElement) => {
  try { await navigator.clipboard.writeText(t.dataset.copy!); t.textContent = "copied"; }
  catch { t.textContent = "copy failed — select it"; }
  setTimeout(() => (t.textContent = "copy"), 1600);
};
document.addEventListener("click", (e) => { const t = e.target as HTMLElement; if (t.dataset.copy) doCopy(t); });
document.addEventListener("keydown", (e) => { const t = e.target as HTMLElement; if (t.dataset.copy && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); doCopy(t); } });
window.addEventListener("hashchange", route);
route();

// Offline fallback only (public/sw.js): navigations still go to the network every time; the worker answers with
// public/offline.html only when that fetch throws, so an online visitor never sees a cached shell or stale chain state.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
