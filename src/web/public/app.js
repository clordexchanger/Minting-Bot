const $ = (id) => document.getElementById(id);

function showToast(message, kind = "success") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.style.display = "block";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (el.style.display = "none"), 6000);
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- Modal ----------
function openModal(title, bodyHtml, actions = []) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = bodyHtml;
  $("modal-actions").innerHTML = "";
  actions.forEach((a) => {
    const btn = document.createElement("button");
    btn.textContent = a.label;
    if (a.secondary) btn.className = "secondary";
    btn.addEventListener("click", () => {
      a.onClick?.();
      if (a.closeOnClick !== false) closeModal();
    });
    $("modal-actions").appendChild(btn);
  });
  $("modal-overlay").style.display = "flex";
}

function closeModal() {
  $("modal-overlay").style.display = "none";
}

$("modal-close").addEventListener("click", closeModal);
$("modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") closeModal();
});

function pickWalletModal(eligibleWallets) {
  return new Promise((resolve, reject) => {
    openModal(
      "Choose a wallet",
      '<div class="modal-wallet-list" id="wallet-pick-list"></div>',
      [{ label: "Cancel", secondary: true, onClick: () => reject(new Error("Cancelled")) }]
    );
    const container = $("wallet-pick-list");
    eligibleWallets.forEach((w) => {
      const btn = document.createElement("button");
      btn.textContent = `${w.label} — ${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
      btn.addEventListener("click", () => {
        closeModal();
        resolve(w.label);
      });
      container.appendChild(btn);
    });
  });
}

function promptModal(title, placeholder) {
  return new Promise((resolve, reject) => {
    openModal(
      title,
      `<input type="text" id="modal-input" placeholder="${placeholder}" style="width:100%; background:#0d0f14; border:1px solid var(--panel-border); color:var(--text); border-radius:6px; padding:10px 12px; font-family:inherit;" />`,
      [
        { label: "Cancel", secondary: true, onClick: () => reject(new Error("Cancelled")) },
        {
          label: "Save",
          onClick: () => {
            const val = $("modal-input").value.trim();
            if (!val) {
              reject(new Error("Cancelled"));
              return;
            }
            resolve(val);
          },
        },
      ]
    );
    setTimeout(() => $("modal-input")?.focus(), 50);
  });
}

function showDryRunModal(targetLabel, result) {
  const statusLine = result.ok ? "✅ Would likely succeed" : "❌ Issues found";
  const issuesText = (result.issues || []).map((i) => `• ${i}`).join("\n");
  const infoText = Object.entries(result.info || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const body = [statusLine, issuesText, infoText].filter(Boolean).join("\n\n");
  openModal(`Dry run — ${targetLabel}`, body, [{ label: "Close", secondary: true }]);
}

function isCancelled(err) {
  return err instanceof Error && err.message === "Cancelled";
}

// ---------- Auth ----------
async function checkAuth() {
  const { authenticated } = await api("/me").catch(() => ({ authenticated: false }));
  if (authenticated) {
    $("login-screen").style.display = "none";
    $("app-screen").style.display = "block";
    loadAll();
  } else {
    $("login-screen").style.display = "flex";
    $("app-screen").style.display = "none";
  }
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  try {
    await api("/login", { method: "POST", body: JSON.stringify({ password: $("login-password").value }) });
    $("login-password").value = "";
    checkAuth();
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

$("logout-btn").addEventListener("click", async () => {
  await api("/logout", { method: "POST" });
  checkAuth();
});

// ---------- Status ----------
async function loadStatus() {
  const s = await api("/status");
  $("status-content").innerHTML = [
    ["Targets", `${s.targets} (${s.evmTargets} evm, ${s.solanaTargets} solana)`],
    ["Wallets", s.wallets],
    ["EVM chains", s.evmChainsConfigured.length],
    ["Solana RPCs", s.solanaRpcsConfigured],
    ["Pending schedules", s.schedulesPending],
  ]
    .map(([label, value]) => `<div class="status-item"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join("");
}

// ---------- Targets ----------
let cachedWallets = [];

async function loadTargets() {
  const targets = await api("/targets");
  const list = $("targets-list");
  if (targets.length === 0) {
    list.innerHTML = '<div class="empty-state">No targets yet — add one above.</div>';
    return;
  }
  list.innerHTML = targets
    .map(
      (t) => `
    <div class="card" data-target-id="${t.id}" data-chain="${t.chain}">
      <div class="card-info">
        <div class="card-title">${t.label}<span class="chain-tag ${t.chain}">${t.chain}${t.chainId ? " " + t.chainId : ""}</span></div>
        <div class="card-sub">${t.address}${t.priceNote ? " · " + t.priceNote : ""}${t.wallet ? " · wallet: " + t.wallet : ""}</div>
      </div>
      <div class="card-actions">
        <button class="dryrun-btn" data-id="${t.id}">Dry run</button>
        <button class="mint-btn" data-id="${t.id}">Mint</button>
        <button class="secondary remove-target-btn" data-id="${t.id}">Remove</button>
      </div>
    </div>`
    )
    .join("");
}

async function pickWallet(target) {
  if (target.wallet) return target.wallet;
  const eligible = cachedWallets.filter((w) => w.chain === target.chain);
  if (eligible.length === 0) {
    throw new Error(`No ${target.chain} wallets available — add one first.`);
  }
  if (eligible.length === 1) return eligible[0].label;
  return pickWalletModal(eligible);
}

$("targets-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.classList.contains("remove-target-btn")) {
    if (!confirm("Remove this target?")) return;
    await api(`/targets/${id}`, { method: "DELETE" });
    loadTargets();
    return;
  }

  const targets = await api("/targets");
  const target = targets.find((t) => t.id === id);
  if (!target) return;

  if (btn.classList.contains("dryrun-btn")) {
    btn.disabled = true;
    btn.textContent = "Running...";
    try {
      const wallet = await pickWallet(target);
      const result = await api("/dryrun", { method: "POST", body: JSON.stringify({ targetId: id, walletLabel: wallet }) });
      showDryRunModal(target.label, result);
    } catch (err) {
      if (!isCancelled(err)) showToast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Dry run";
    }
  }

  if (btn.classList.contains("mint-btn")) {
    if (!confirm(`Mint ${target.label} now? This sends a real transaction.`)) return;
    btn.disabled = true;
    btn.textContent = "Minting...";
    try {
      const wallet = await pickWallet(target);
      const result = await api("/mint", { method: "POST", body: JSON.stringify({ targetId: id, walletLabel: wallet }) });
      showToast(
        `Mint ${result.confirmed ? "confirmed" : result.reverted ? "reverted" : "submitted"}: ${result.txHash || result.signature}`,
        result.confirmed ? "success" : "error"
      );
      loadWallets();
    } catch (err) {
      if (!isCancelled(err)) showToast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Mint";
    }
  }
});

// Add-target form
$("show-add-target").addEventListener("click", () => {
  const walletSelect = $("t-wallet");
  walletSelect.innerHTML =
    '<option value="">No default wallet</option>' +
    cachedWallets.filter((w) => w.chain === "evm").map((w) => `<option value="${w.label}">${w.label}</option>`).join("");
  $("add-target-form").style.display = "flex";
});
$("cancel-add-target").addEventListener("click", () => ($("add-target-form").style.display = "none"));
$("t-hasqty").addEventListener("change", (e) => ($("t-qty").style.display = e.target.checked ? "block" : "none"));
$("t-payable").addEventListener("change", (e) => ($("t-price").style.display = e.target.checked ? "block" : "none"));

$("submit-add-target").addEventListener("click", async () => {
  const label = $("t-label").value.trim();
  const address = $("t-address").value.trim();
  const chainId = Number($("t-chainid").value.trim());
  const hasQty = $("t-hasqty").checked;
  const qty = Number($("t-qty").value.trim() || "1");
  const payable = $("t-payable").checked;
  const price = $("t-price").value.trim();
  const wallet = $("t-wallet").value || undefined;

  if (!label || !address || !chainId) {
    showToast("Label, address, and chain ID are required", "error");
    return;
  }

  const functionAbi = hasQty
    ? `function mint(uint256 quantity) ${payable ? "payable" : ""}`.trim()
    : `function mint() ${payable ? "payable" : ""}`.trim();
  const mintSpec = JSON.stringify({
    functionAbi,
    args: hasQty ? [qty] : [],
    ...(payable && price ? { valueEth: price } : {}),
  });

  try {
    await api("/targets", {
      method: "POST",
      body: JSON.stringify({
        label,
        chain: "evm",
        address,
        mintSpec,
        chainId,
        priceNote: payable && price ? `${price} ETH` : undefined,
        wallet,
      }),
    });
    $("add-target-form").style.display = "none";
    ["t-label", "t-address", "t-chainid", "t-qty", "t-price"].forEach((id) => ($(id).value = ""));
    $("t-hasqty").checked = false;
    $("t-payable").checked = false;
    loadTargets();
    showToast(`Target "${label}" added`);
  } catch (err) {
    showToast(err.message, "error");
  }
});

// ---------- Wallets ----------
function formatBalances(balances) {
  if (!balances || balances.length === 0) return '<div class="balance-row">no balance data</div>';
  return (
    '<div class="balance-list">' +
    balances
      .map((b) => {
        const label = b.chainId === "solana" ? "SOL" : `chain ${b.chainId}`;
        const amount = b.balance === null || b.balance === undefined ? "—" : Number(b.balance).toFixed(5);
        return `<div class="balance-row">${label}: <span class="amount">${amount}</span></div>`;
      })
      .join("") +
    "</div>"
  );
}

async function loadWallets() {
  const wallets = await api("/wallets");
  cachedWallets = wallets;
  const list = $("wallets-list");
  if (wallets.length === 0) {
    list.innerHTML = '<div class="empty-state">No wallets yet — generate one above.</div>';
    return;
  }
  list.innerHTML = wallets
    .map(
      (w) => `
    <div class="card" data-chain="${w.chain}">
      <div class="card-info">
        <div class="card-title">${w.label}<span class="chain-tag ${w.chain}">${w.chain}</span></div>
        <div class="card-sub">${w.address}</div>
        <div class="card-sub">sweep to: ${w.sweepTo || "not set"}</div>
        ${formatBalances(w.balances)}
      </div>
      <div class="card-actions">
        <button class="secondary set-sweep-btn" data-label="${w.label}">Set sweep</button>
        <button class="secondary danger remove-wallet-btn" data-label="${w.label}">Remove</button>
      </div>
    </div>`
    )
    .join("");
}

$("wallets-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const label = btn.dataset.label;

  if (btn.classList.contains("remove-wallet-btn")) {
    if (!confirm(`Remove wallet "${label}"? This only deletes it from the bot's keystore, it doesn't touch on-chain funds.`)) return;
    await api(`/wallets/${label}`, { method: "DELETE" });
    loadWallets();
    return;
  }

  if (btn.classList.contains("set-sweep-btn")) {
    try {
      const destination = await promptModal(`Sweep destination for ${label}`, "Destination address");
      await api(`/wallets/${label}/sweep-destination`, { method: "POST", body: JSON.stringify({ destination }) });
      loadWallets();
      showToast("Sweep destination set");
    } catch (err) {
      if (!isCancelled(err)) showToast(err.message, "error");
    }
  }
});

$("show-add-wallet").addEventListener("click", () => ($("add-wallet-form").style.display = "flex"));
$("cancel-add-wallet").addEventListener("click", () => ($("add-wallet-form").style.display = "none"));

$("submit-add-wallet").addEventListener("click", async () => {
  const chain = $("w-chain").value;
  const label = $("w-label").value.trim();
  if (!label) {
    showToast("Label is required", "error");
    return;
  }
  try {
    const wallet = await api("/wallets", { method: "POST", body: JSON.stringify({ chain, label }) });
    $("add-wallet-form").style.display = "none";
    $("w-label").value = "";
    loadWallets();
    showToast(`Wallet "${wallet.label}" created: ${wallet.address}`);
  } catch (err) {
    showToast(err.message, "error");
  }
});

// ---------- Schedules ----------
async function loadSchedules() {
  const schedules = await api("/schedules");
  const targets = await api("/targets");
  const list = $("schedules-list");
  if (schedules.length === 0) {
    list.innerHTML = '<div class="empty-state">No schedules pending.</div>';
    return;
  }
  list.innerHTML = schedules
    .map((s) => {
      const target = targets.find((t) => t.id === s.targetId);
      return `
    <div class="card">
      <div class="card-info">
        <div class="card-title">${target ? target.label : s.targetId}</div>
        <div class="card-sub">${s.fireAtIso} · wallet: ${s.walletLabel}</div>
      </div>
      <div class="card-actions">
        <button class="secondary danger cancel-schedule-btn" data-id="${s.id}">Cancel</button>
      </div>
    </div>`;
    })
    .join("");
}

$("schedules-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button.cancel-schedule-btn");
  if (!btn) return;
  await api(`/schedules/${btn.dataset.id}`, { method: "DELETE" });
  loadSchedules();
});

// ---------- Init ----------
async function loadAll() {
  await loadWallets();
  await Promise.all([loadStatus(), loadTargets(), loadSchedules()]);
}

checkAuth();
setInterval(() => {
  if ($("app-screen").style.display !== "none") loadAll();
}, 30_000);
