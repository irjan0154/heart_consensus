// v4
console.log("%c♥ HeartConsensus loaded", "color:#E8527A;font-weight:bold");
// ─── CONFIG ───────────────────────────────────────────────
const CONTRACT_ADDRESS  = '0x4cCE0E59603fF60D75b5c7Dac0e4Ae3C0c7a627F';
const GENLAYER_RPC      = 'https://studio.genlayer.com/api';
const CHAIN_ID          = 61999;
const CHAIN_ID_HEX      = '0xF22F';
const CONSENSUS_CONTRACT = '0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575';
const NUM_VALIDATORS    = 3n;
const MAX_ROTATIONS     = 2n;
const ADD_TX_SELECTOR   = '0x27241a99';

const GENLAYER_NETWORK = {
  chainId: CHAIN_ID_HEX,
  chainName: 'GenLayer Studio Testnet',
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  rpcUrls: [GENLAYER_RPC],
  blockExplorerUrls: ['https://explorer-studio.genlayer.com'],
};

// ─── STATE ────────────────────────────────────────────────
let walletAddress = null;
let provider = null;


// ─── ABI Encoding for addTransaction ──────────────────────
// Minimal ABI encoder for: addTransaction(address,address,uint256,uint256,bytes)
function abiEncodeAddTransaction(sender, recipient, numValidators, maxRotations, txDataHex) {
  // Each slot is 32 bytes. Layout:
  // [selector 4b][addr1 32b][addr2 32b][uint256 32b][uint256 32b][offset 32b][len 32b][data padded]
  function pad32(hexStr) {
    const s = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
    return s.padStart(64, '0');
  }
  function addrSlot(addr) { return pad32(addr.toLowerCase().replace('0x', '')); }
  function uint256Slot(n) { return pad32(BigInt(n).toString(16)); }

  const txData = txDataHex.startsWith('0x') ? txDataHex.slice(2) : txDataHex;
  const txLen = txData.length / 2;
  // bytes param: offset = 5 * 32 = 160 = 0xa0
  const offset = uint256Slot(160);
  const lenSlot = uint256Slot(txLen);
  // pad txData to multiple of 32 bytes
  const padded = txData.padEnd(Math.ceil(txData.length / 64) * 64, '0');

  const hex = ADD_TX_SELECTOR.slice(2)
    + addrSlot(sender)
    + addrSlot(recipient)
    + uint256Slot(numValidators)
    + uint256Slot(maxRotations)
    + offset
    + lenSlot
    + padded;

  return '0x' + hex;
}

// ─── GenLayer Calldata Encoding ───────────────────────────
// Faithful port of genlayer-js/src/abi/calldata/encoder.ts

const GL_BITS = 3;
const GL_PINT = 1, GL_NINT = 2, GL_BYTES = 3, GL_STR = 4, GL_ARR = 5, GL_MAP = 6;
const GL_NULL = 0, GL_FALSE = 8, GL_TRUE = 16; // (n << 3) | 0

function glWriteNum(buf, n) {
  if (n === 0n) { buf.push(0); return; }
  while (n > 0n) {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    buf.push(b);
  }
}
function glTagNum(buf, n, type) {
  glWriteNum(buf, (BigInt(n) << BigInt(GL_BITS)) | BigInt(type));
}
function glEncodeImpl(buf, v) {
  if (v === null || v === undefined) { buf.push(GL_NULL); return; }
  if (v === true)  { buf.push(GL_TRUE);  return; }
  if (v === false) { buf.push(GL_FALSE); return; }
  if (typeof v === 'number' || typeof v === 'bigint') {
    const n = BigInt(v);
    if (n >= 0n) glTagNum(buf, n, GL_PINT);
    else         glTagNum(buf, -n - 1n, GL_NINT);
    return;
  }
  if (typeof v === 'string') {
    const b = new TextEncoder().encode(v);
    glTagNum(buf, b.length, GL_STR);
    for (const c of b) buf.push(c);
    return;
  }
  if (v instanceof Uint8Array) {
    glTagNum(buf, v.length, GL_BYTES);
    for (const c of v) buf.push(c);
    return;
  }
  if (Array.isArray(v)) {
    glTagNum(buf, v.length, GL_ARR);
    for (const item of v) glEncodeImpl(buf, item);
    return;
  }
  // object → MAP (keys sorted lexicographically by UTF-8 bytes)
  const entries = Object.entries(v);
  entries.sort((a, b) => {
    const ka = new TextEncoder().encode(a[0]);
    const kb = new TextEncoder().encode(b[0]);
    for (let i = 0; i < Math.min(ka.length, kb.length); i++)
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return ka.length - kb.length;
  });
  glTagNum(buf, entries.length, GL_MAP);
  for (const [k, val] of entries) {
    const kb = new TextEncoder().encode(k);
    glWriteNum(buf, BigInt(kb.length));
    for (const c of kb) buf.push(c);
    glEncodeImpl(buf, val);
  }
}
function glEncode(v) {
  const buf = [];
  glEncodeImpl(buf, v);
  return new Uint8Array(buf);
}

// RLP: minimal encoder matching viem's toRlp
function rlpLen(len, offset) {
  if (len < 56) return [offset + len];
  const hex = len.toString(16).padStart(len.toString(16).length % 2 ? len.toString(16).length + 1 : len.toString(16).length, '0');
  const lb = hex.match(/.{2}/g).map(h => parseInt(h, 16));
  return [offset + 55 + lb.length, ...lb];
}
function rlpItem(bytes) {
  if (bytes.length === 1 && bytes[0] < 0x80) return [...bytes];
  return [...rlpLen(bytes.length, 0x80), ...bytes];
}
function rlpList(items) {
  const body = items.flatMap(i => rlpItem([...i]));
  return new Uint8Array([...rlpLen(body.length, 0xc0), ...body]);
}
function toHex(bytes) {
  return '0x' + [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
}

// Build calldata for eth_sendTransaction: RLP([glEncode({method,args}), leaderOnly])
function buildWriteCalldata(method, args) {
  const obj = { method };
  if (args && args.length > 0) obj.args = args;
  const encoded = glEncode(obj);
  return toHex(rlpList([encoded, new Uint8Array([])]));
}

// Build calldata for gen_call (read): raw GL bytes, NO RLP wrapper
function buildReadCalldata(method, args) {
  const obj = { method };
  if (args && args.length > 0) obj.args = args;
  return toHex(glEncode(obj));
}

// ─── Decode GenLayer result from transaction ───────────────
// GenLayer stores result as base64 in tx.consensus_data.leader_receipt[].result
// First byte = result code: 0=return(ok), 1=rollback, 2=contract_error, 3=error
// For code=0: remaining bytes are GL-encoded return value
// For a string return type: GL_STR encoded bytes → raw string

// Read LEB128-encoded varint from bytes at index i, return {value, i}
function readLEB128(bytes, i) {
  let val = 0n, shift = 0n;
  while (true) {
    const b = bytes[i++];
    val += BigInt(b & 0x7f) << shift;
    shift += 7n;
    if ((b & 0x80) === 0) break;
  }
  return { val, i };
}

// Decode a GL-encoded value and return the raw JS value
function glDecodeAny(bytes, i = 0) {
  const { val: tag, i: next } = readLEB128(bytes, i);
  const type = Number(tag & 7n);
  const data = tag >> 3n;
  const len  = Number(data);
  switch (type) {
    case 0: { // SPECIAL: null=0, false=8>>3=1, true=16>>3=2
      const s = Number(data);
      return { val: s === 0 ? null : s === 1 ? false : true, i: next };
    }
    case 1: return { val: Number(data), i: next };   // PINT
    case 2: return { val: -Number(data) - 1, i: next }; // NINT
    case 3: { // BYTES
      return { val: bytes.slice(next, next + len), i: next + len };
    }
    case 4: { // STR
      const str = new TextDecoder().decode(bytes.slice(next, next + len));
      return { val: str, i: next + len };
    }
    case 5: { // ARR
      let pos = next; const arr = [];
      for (let k = 0; k < len; k++) {
        const r = glDecodeAny(bytes, pos); arr.push(r.val); pos = r.i;
      }
      return { val: arr, i: pos };
    }
    case 6: { // MAP
      let pos = next; const map = {};
      for (let k = 0; k < len; k++) {
        // key: raw LEB128 length then bytes (no type tag)
        const { val: klen, i: ki } = readLEB128(bytes, pos);
        const key = new TextDecoder().decode(bytes.slice(ki, ki + Number(klen)));
        pos = ki + Number(klen);
        const r = glDecodeAny(bytes, pos); map[key] = r.val; pos = r.i;
      }
      return { val: map, i: pos };
    }
    default: return { val: null, i: next };
  }
}

function glDecodeStr(bytes) {
  try {
    const { val } = glDecodeAny(bytes, 0);
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object' && !Array.isArray(val)) return JSON.stringify(val);
  } catch(e) { console.warn('glDecodeAny failed:', e); }
  // Fallback: raw UTF-8
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function extractMatchFromResult(resultB64) {
  // resultB64: base64-encoded bytes
  // bytes[0] = result code (0 = success/return)
  try {
    const raw = Uint8Array.from(atob(resultB64), c => c.charCodeAt(0));
    
    if (raw[0] !== 0) {
      // Not a successful return — show error payload as text
      const msg = new TextDecoder().decode(raw.slice(1));
      console.warn('Contract error payload:', msg);
      return null;
    }
    const payload = raw.slice(1); // GL-encoded return value
    const str = glDecodeStr(payload);
    
    const i = str.indexOf('{'), j = str.lastIndexOf('}');
    if (i !== -1 && j !== -1) return JSON.parse(str.slice(i, j + 1));
  } catch(e) {
    console.error('extractMatchFromResult error:', e);
  }
  return null;
}

// ─── STATE ────────────────────────────────────────────────
const questions = [
  "How old are you?",
  "How would your ex describe you in 3 words?",
  "Saturday 2pm. Where are you and who are you with?",
  "Alone time is... (finish the sentence)",
  "If your outfit could talk, what would it say?",
  "What do you secretly judge people for?",
  "Your last impulse purchase?",
  "What's your biggest red flag? (be honest)",
  "What's your biggest fear in a relationship?",
  "Describe your perfect partner in one sentence"
];
let current = 0;
const answers = [];

// ─── PROVIDER DETECTION ───────────────────────────────────
function detectProvider() {
  if (typeof window.okxwallet !== 'undefined') return window.okxwallet;
  if (window.ethereum?.providers?.length) return window.ethereum.providers[0];
  if (typeof window.ethereum !== 'undefined') return window.ethereum;
  return null;
}

function waitForProvider(timeoutMs = 4000) {
  return new Promise(resolve => {
    const found = detectProvider();
    if (found) { resolve(found); return; }
    let elapsed = 0;
    const iv = setInterval(() => {
      const p = detectProvider();
      if (p) { clearInterval(iv); resolve(p); return; }
      elapsed += 100;
      if (elapsed >= timeoutMs) { clearInterval(iv); resolve(null); }
    }, 100);
  });
}

// ─── NETWORK HELPERS ──────────────────────────────────────
async function getCurrentChainId() {
  if (!provider) return null;
  try {
    const hex = await provider.request({ method: 'eth_chainId' });
    return parseInt(hex, 16);
  } catch { return null; }
}

async function isOnCorrectNetwork() {
  const id = await getCurrentChainId();
  if (id !== CHAIN_ID) {
    console.warn('[Network] Wrong chain. Got:', id, 'Need:', CHAIN_ID);
    return false;
  }
  return true;
}

window.switchNetwork = async function () {
  if (!provider) { showToast('Connect your wallet first.'); return; }
  const btn = document.querySelector('#networkBanner button');
  if (btn) { btn.textContent = 'Switching…'; btn.disabled = true; }
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (err) {
    if (err.code === 4902 || err.message?.includes('Unrecognized chain')) {
      try {
        await provider.request({ method: 'wallet_addEthereumChain', params: [GENLAYER_NETWORK] });
      } catch {
        showToast('Add GenLayer Testnet manually in your wallet.');
        if (btn) { btn.textContent = 'Switch'; btn.disabled = false; }
        return;
      }
    } else if (err.code === 4001) {
      showToast('Rejected. Switch the network manually.');
      if (btn) { btn.textContent = 'Switch'; btn.disabled = false; }
      return;
    }
  }
  let attempts = 0;
  const poll = setInterval(async () => {
    attempts++;
    const id = await getCurrentChainId();
    if (id === CHAIN_ID) {
      clearInterval(poll);
      hideNetworkBanner();
      showToast('✓ Switched to GenLayer Studio Testnet');
      if (btn) { btn.textContent = 'Switch'; btn.disabled = false; }
    } else if (attempts >= 60) {
      clearInterval(poll);
      showToast('Not switched. Please switch manually.');
      if (btn) { btn.textContent = 'Switch'; btn.disabled = false; }
    }
  }, 500);
};

// ─── NETWORK BANNER ───────────────────────────────────────
function showNetworkBanner() {
  let b = document.getElementById('networkBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'networkBanner';
    b.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:500;' +
      'background:white;border:1px solid rgba(232,82,122,0.4);border-radius:14px;' +
      'padding:16px 24px;text-align:center;font-family:DM Sans,sans-serif;font-size:13px;' +
      'box-shadow:0 8px 32px rgba(232,82,122,0.15);max-width:420px;width:calc(100% - 40px);';
    document.body.appendChild(b);
  }
  b.innerHTML = `
    <div style="font-size:11px;letter-spacing:.1em;color:#E8527A;margin-bottom:6px;font-weight:600;">⚠ WRONG NETWORK</div>
    <div style="color:#3A3A45;margin-bottom:4px;font-size:14px;font-weight:500;">
      Switch to <strong>GenLayer Studio Testnet</strong>
    </div>
    <div style="color:#AAAABC;font-size:11px;margin-bottom:12px;">
      Chain ID: <strong style="color:#E8527A;">61999</strong> &nbsp;|&nbsp;
      RPC: <strong style="color:#E8527A;">studio.genlayer.com/api</strong>
    </div>
    <button onclick="window.switchNetwork()" style="
      background:linear-gradient(135deg,#E8527A,#F07090);border:none;color:#fff;
      font-family:DM Sans,sans-serif;font-size:13px;font-weight:500;
      padding:8px 22px;border-radius:100px;cursor:pointer;">
      Switch Network</button>`;
  b.style.display = 'block';
}

function hideNetworkBanner() {
  const b = document.getElementById('networkBanner');
  if (b) b.style.display = 'none';
}

// ─── TOAST ────────────────────────────────────────────────
function showToast(msg) {
  let t = document.getElementById('hcToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'hcToast';
    t.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);z-index:600;' +
      'background:#3A3A45;color:white;padding:10px 20px;border-radius:100px;font-size:13px;' +
      'font-family:DM Sans,sans-serif;opacity:0;transition:opacity 0.3s;pointer-events:none;' +
      'white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.2);';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

// ─── WALLET ───────────────────────────────────────────────
async function connectWallet() {
  provider = await waitForProvider(4000);
  if (!provider) {
    showToast('No wallet found. Install MetaMask or Rabby.');
    return;
  }
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts?.length) { showToast('No accounts found. Unlock your wallet.'); return; }
    walletAddress = accounts[0];

    if (await isOnCorrectNetwork()) {
      hideNetworkBanner();
    } else {
      showNetworkBanner();
    }

    closeModal('walletModal');
    updateWalletBtn();

    // Listen for network changes
    provider.on('chainChanged', async () => {
      const id = await getCurrentChainId();
      if (id === CHAIN_ID) {
        hideNetworkBanner();
        showToast('✓ GenLayer Studio Testnet connected');
      } else {
        showNetworkBanner();
      }
    });

    // Listen for account changes
    provider.on('accountsChanged', async (accs) => {
      if (!accs.length) {
        walletAddress = null;
        updateWalletBtn();
        hideNetworkBanner();
        showToast('Wallet disconnected');
        return;
      }
      walletAddress = accs[0];
      updateWalletBtn();
      if (!await isOnCorrectNetwork()) showNetworkBanner();
      else hideNetworkBanner();
    });

  } catch(e) {
    if (e.code === 4001) showToast('Connection rejected.');
    else { console.error('connectWallet error:', e); showToast('Failed to connect. Try again.'); }
  }
}

function updateWalletBtn() {
  const btn = document.querySelector('.btn-wallet');
  if (!btn) return;
  if (walletAddress) {
    btn.textContent = walletAddress.slice(0,6) + '...' + walletAddress.slice(-4);
    btn.style.borderColor = 'rgba(232,82,122,0.4)';
    btn.style.color = '#E8527A';
    btn.title = 'Click to disconnect';
    btn.onclick = disconnectWallet;
  } else {
    btn.textContent = 'Connect Wallet';
    btn.style.borderColor = 'rgba(58,58,69,0.18)';
    btn.style.color = 'var(--dark, #3A3A45)';
    btn.title = '';
    btn.onclick = openWalletModal;
  }
}

function disconnectWallet() {
  walletAddress = null;
  provider = null;
  updateWalletBtn();
  hideNetworkBanner();
  showToast('Wallet disconnected');
}

// ─── QUIZ ─────────────────────────────────────────────────
function startQuiz() {
  if (!walletAddress) { openWalletModal(); return; }
  document.getElementById('quizScreen').classList.add('open');
  document.body.style.overflow = 'hidden';
  updateQuiz();
}
function updateQuiz() {
  document.getElementById('quizCounter').textContent = `Question ${current + 1} of ${questions.length}`;
  document.getElementById('quizQuestion').textContent = questions[current];
  document.getElementById('quizInput').value = answers[current] || '';
  document.getElementById('quizInput').focus();
  document.getElementById('progressFill').style.width = `${((current + 1) / questions.length) * 100}%`;
  const backBtn = document.getElementById('quizBackBtn');
  if (current === 0) { backBtn.textContent = '← Home'; backBtn.onclick = goHome; }
  else               { backBtn.textContent = '← Back'; backBtn.onclick = quizBack; }
  backBtn.style.opacity = '1'; backBtn.style.pointerEvents = 'auto';
}
function quizNext() {
  const val = document.getElementById('quizInput').value.trim();
  if (!val) {
    document.getElementById('quizInput').style.borderColor = 'rgba(232,82,122,0.6)';
    setTimeout(() => document.getElementById('quizInput').style.borderColor = 'rgba(232,82,122,0.25)', 600);
    return;
  }
  answers[current] = val;
  if (current < questions.length - 1) { current++; updateQuiz(); }
  else {
    // Age check — first answer is age
    const age = parseInt(answers[0]);
    if (!isNaN(age) && age < 18) {
      showTooYoungScreen();
      return;
    }
    submitToContract();
  }
}
function quizBack() { if (current > 0) { current--; updateQuiz(); } }
function goHome() {
  document.getElementById('quizScreen').classList.remove('open');
  document.getElementById('resultScreen').classList.remove('open');
  document.body.style.overflow = '';
  current = 0; answers.length = 0;
}

// ─── CONTRACT ─────────────────────────────────────────────
async function submitToContract() {
  document.getElementById('quizScreen').classList.remove('open');
  showWaiting();

  // Check network before submitting
  if (!await isOnCorrectNetwork()) {
    hideWaiting();
    showNetworkBanner();
    showToast('⚠ Wrong network! Switch to GenLayer Studio Testnet first.');
    return;
  }

  const argValues = answers.slice(0, 10);

  try {
    // _txData for consensus = RLP([glEncode(calldata), leaderOnly])
    const txData = buildWriteCalldata('find_soulmate', argValues);
    

    // Encode addTransaction(sender, recipient, numValidators, maxRotations, txData)
    const encodedCall = abiEncodeAddTransaction(
      walletAddress, CONTRACT_ADDRESS, NUM_VALIDATORS, MAX_ROTATIONS, txData
    );
    

    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: walletAddress, to: CONSENSUS_CONTRACT, data: encodedCall, gas: '0x' + (500000).toString(16) }]
    });

    console.log("%c→ TX sent: " + txHash, "color:#E8527A");
    animateWaiting();
    await pollForResult(txHash);
  } catch(e) {
    console.error(e);
    hideWaiting();
    alert('Transaction failed: ' + (e.message || e));
    goHome();
  }
}

async function pollForResult(txHash) {
  const maxAttempts = 80;
  let attempt = 0;

  const interval = setInterval(async () => {
    attempt++;
    updateWaitingMessage(attempt);

    try {
      const resp = await fetch(GENLAYER_RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_getTransactionByHash', params:[txHash] })
      }).then(r => r.json());

      // Log raw response first time to see structure
      

      const tx = resp?.result;
      // Try every possible status field location
      const status = tx?.statusName
        ?? tx?.status_name
        ?? tx?.status
        ?? tx?.consensus_data?.status
        ?? tx?.data?.status;

      if (attempt % 5 === 1) console.log("%c⏳ Polling attempt " + attempt + " | status: " + status, "color:#aaa");

      const DONE = ['FINALIZED','ACCEPTED','7','5','6'];
      if (status !== undefined && status !== null && DONE.some(s => String(status) === s)) {
        clearInterval(interval);
        console.log("%c✓ TX finalized", "color:#4AE296");

        // ── Strategy 1: extract result from leader_receipt in the TX itself ──
        const match = extractResultFromTx(tx);
        if (match) { hideWaiting(); showResult(match); return; }

        // ── Strategy 2: check validators contract_state directly ──
        const validators = tx?.consensus_data?.validators || [];
        for (const v of validators) {
          const vm = extractFromContractState(v?.contract_state);
          if (vm) { hideWaiting(); showResult(vm); return; }
        }

        // ── Strategy 3: try gen_call as last resort ──
        try {
          await fetchResultViaGenCall(txHash);
        } catch(e) {
          console.warn('gen_call failed, showing fail screen:', e.message);
          hideWaiting();
          showConsensusFailScreen();
        }
        return;
      }

    } catch(e) { console.warn("Polling error:", e.message); }

    if (attempt >= maxAttempts) {
      clearInterval(interval);
      hideWaiting();
      showConsensusFailScreen();
    }
  }, 3000);
}

function extractResultFromTx(tx) {
  try {
    // GenLayer puts consensus result in consensus_data.leader_receipt
    const leaderReceipt = tx?.consensus_data?.leader_receipt;
    if (!leaderReceipt) { return null; }

    const receipts = Array.isArray(leaderReceipt) ? leaderReceipt : [leaderReceipt];
    for (const r of receipts) {
      
      // result is base64 encoded
      if (r.result && typeof r.result === 'string') {
        const match = extractMatchFromResult(r.result);
        if (match) return match;
      }
    }
  } catch(e) { console.error('extractResultFromTx error:', e); }
  return null;
}

// Extract match JSON from contract_state map (values are base64-encoded)
function extractFromContractState(contractState) {
  if (!contractState || typeof contractState !== 'object') return null;
  for (const [key, b64val] of Object.entries(contractState)) {
    if (typeof b64val !== 'string') continue;
    try {
      const raw = atob(b64val);
      // Look for JSON object in the decoded string
      const i = raw.indexOf('{'), j = raw.lastIndexOf('}');
      if (i === -1 || j === -1) continue;
      const candidate = raw.slice(i, j + 1);
      const obj = JSON.parse(candidate);
      // Validate it has expected match fields
      if (obj.name && obj.age && obj.tagline && obj.description) {
        console.log("%c♥ Match found in contract_state: " + obj.name, "color:#E8527A");
        return obj;
      }
    } catch(e) { /* not JSON, skip */ }
  }
  return null;
}

async function fetchResultViaGenCall(txHash, retries = 6, delayMs = 5000) {
  await new Promise(r => setTimeout(r, delayMs));

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(GENLAYER_RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'gen_call',
          params: [{
            Type: 'read',
            Data: buildReadCalldata('get_last_match', []),
            from: walletAddress,
            to: CONTRACT_ADDRESS
          }]
        })
      }).then(r => r.json());

      

      if (resp?.error) {
        console.warn("gen_call error attempt " + attempt + ":", resp.error?.message);
        // Try to extract result from contract_state inside the error data
        const match = extractFromContractState(resp?.error?.data?.receipt?.contract_state);
        if (match) { hideWaiting(); showResult(match); return; }
        if (attempt < retries) { await new Promise(r => setTimeout(r, 4000)); continue; }
        throw new Error('gen_call error: ' + (resp.error.message || JSON.stringify(resp.error)));
      }

      // result is a hex string; first byte = result code (0 = success)
      let hexOrObj = resp?.result;
      let hexStr = typeof hexOrObj === 'string' ? hexOrObj
        : (hexOrObj?.data ? hexOrObj.data : null);

      if (hexStr) {
        const raw = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
        const bytes = new Uint8Array(raw.match(/.{2}/g).map(b => parseInt(b, 16)));
        // gen_call returns raw GL-encoded value (no result-code prefix)
        const str = glDecodeStr(bytes);
        if (str) console.log("%c♥ Result decoded", "color:#E8527A");
        if (str) {
          const i = str.indexOf('{'), j = str.lastIndexOf('}');
          if (i !== -1 && j !== -1) {
            try {
              const match = JSON.parse(str.slice(i, j + 1));
              if (match && match.name) { hideWaiting(); showResult(match); return; }
            } catch(e) { console.warn('JSON parse failed:', e); }
          }
        }
      }

      if (attempt < retries) { await new Promise(r => setTimeout(r, 4000)); }
      else throw new Error('Could not decode gen_call result: ' + JSON.stringify(resp));

    } catch(e) {
      console.error('gen_call attempt', attempt, 'error:', e);
      if (attempt >= retries) {
        // Last resort: try reading result from TX itself
        try {
          const txResp = await fetch(GENLAYER_RPC, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_getTransactionByHash', params:[txHash] })
          }).then(r => r.json());
          const tx = txResp?.result;
          if (tx) {
            const match = extractResultFromTx(tx);
            if (match) { hideWaiting(); showResult(match); return; }
            const validators = tx?.consensus_data?.validators || [];
            for (const v of validators) {
              const m = extractFromContractState(v?.contract_state);
              if (m) { hideWaiting(); showResult(m); return; }
            }
          }
        } catch(ex) { console.error('TX fallback failed:', ex); }
        hideWaiting();
        showConsensusFailScreen();
        return;
      }
      else await new Promise(r => setTimeout(r, 4000));
    }
  }
}

// ─── TOO YOUNG SCREEN ────────────────────────────────────
function showTooYoungScreen() {
  document.getElementById('quizScreen').classList.remove('open');

  const el = document.createElement('div');
  el.id = 'tooYoungScreen';
  el.style.cssText = [
    'position:fixed','inset:0','z-index:1000',
    'background:#fff','display:flex','flex-direction:column',
    'align-items:center','justify-content:center',
    'gap:20px','padding:40px','text-align:center'
  ].join(';');

  el.innerHTML = `
    <div style="font-size:52px">🚫</div>
    <h2 style="font-family:'DM Sans',sans-serif;font-size:22px;color:#1a1a2e;margin:0;line-height:1.4;">
      The validators saw your age<br>and collectively said: no.
    </h2>
    <p style="font-family:'DM Sans',sans-serif;font-size:15px;color:#888;max-width:300px;line-height:1.6;margin:0;">
      Grow up and come back.
    </p>
    <button onclick="document.getElementById('tooYoungScreen').remove(); goHome();"
      style="margin-top:8px;padding:14px 32px;
      background:linear-gradient(135deg,#E8527A,#ff6b9d);
      color:#fff;border:none;border-radius:100px;font-size:15px;
      font-family:'DM Sans',sans-serif;cursor:pointer;font-weight:500;">
      Back to Home
    </button>
  `;

  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
}

// ─── CONSENSUS FAIL SCREEN ───────────────────────────────
function resetAndRetry() {
  // Reset quiz state and start fresh
  current = 0;
  answers.length = 0;
  startQuiz();
}

function showConsensusFailScreen() {
  // Remove existing fail screen if any
  const existing = document.getElementById('failScreen');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'failScreen';
  el.style.cssText = [
    'position:fixed','inset:0','z-index:1000',
    'background:#fff','display:flex','flex-direction:column',
    'align-items:center','justify-content:center',
    'gap:20px','padding:40px','text-align:center'
  ].join(';');

  el.innerHTML = `
    <div style="font-size:48px">💔</div>
    <h2 style="font-family:'DM Sans',sans-serif;font-size:22px;color:#1a1a2e;margin:0;">
      Consensus failed.
    </h2>
    <p style="font-family:'DM Sans',sans-serif;font-size:15px;color:#666;max-width:320px;line-height:1.6;margin:0;">
      The validators reviewed your answers and simply gave up.
    </p>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;">
      <button onclick="document.getElementById('failScreen').remove(); resetAndRetry();"
        style="padding:14px 32px;background:linear-gradient(135deg,#E8527A,#ff6b9d);
        color:#fff;border:none;border-radius:100px;font-size:15px;
        font-family:'DM Sans',sans-serif;cursor:pointer;font-weight:500;">
        Try Again
      </button>
      <button onclick="document.getElementById('failScreen').remove(); goHome();"
        style="padding:10px 24px;background:none;border:1px solid rgba(58,58,69,0.2);
        border-radius:100px;font-size:14px;font-family:'DM Sans',sans-serif;
        color:#666;cursor:pointer;">
        Back to Home
      </button>
    </div>
  `;

  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
}

// ─── WAITING SCREEN ───────────────────────────────────────
const waitingMessages = [
  "Submitting your profile to the blockchain...",
  "3 validators are reading your answers...",
  "Validator #1 is judging you. Lovingly.",
  "Validator #2 found someone. Oh no.",
  "Validator #3 disagrees. Loudly.",
  "They're arguing about your red flag...",
  "Two validators have reached consensus...",
  "Final vote in progress...",
  "The blockchain has spoken ♥"
];
function showWaiting() {
  document.getElementById('waitingScreen').classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('waitingMsg').textContent = waitingMessages[0];
}
function hideWaiting() { document.getElementById('waitingScreen').classList.remove('open'); }
function updateWaitingMessage(attempt) {
  const idx = Math.min(Math.floor(attempt / 3), waitingMessages.length - 1);
  document.getElementById('waitingMsg').textContent = waitingMessages[idx];
}
function animateWaiting() {}

// ─── RESULT SCREEN ────────────────────────────────────────
function showResult(match) {
  if (!match || !match.name) {
    console.warn('showResult: invalid match object', match);
    return;
  }
  document.getElementById('resultName').textContent = match.name + ', ' + match.age;
  document.getElementById('resultTagline').textContent = match.tagline || '';
  document.getElementById('resultDescription').textContent = match.description || '';
  document.getElementById('resultCompatibility').textContent = match.compatibility_note || '';
  document.getElementById('resultScreen').classList.add('open');
  document.body.style.overflow = 'hidden';
  loadMatchImage(match);
}

function loadMatchImage(match) {
  const img = document.getElementById('resultImage');
  if (!img) return;

  // Show placeholder while loading
  img.style.display = 'block';
  img.style.opacity = '0.3';
  img.style.filter = 'blur(4px)';
  img.src = '';

  // Build image prompt — always in English for Pollinations
  let prompt = match.image_prompt || '';
  const age = match.age || '';
  const name = match.name || 'person';

  // Check if prompt has too much Cyrillic (Russian) — Pollinations needs English
  const cyrillicCount = (prompt.match(/[а-яёА-ЯЁ]/g) || []).length;
  const totalCount = prompt.replace(/\s/g, '').length || 1;
  const isMostlyRussian = cyrillicCount / totalCount > 0.3;

  if (!prompt || isMostlyRussian) {
    // Build a solid English prompt from structured data
    prompt = `${name}, ${age} years old, realistic candid portrait photo, natural light, 35mm lens, photorealistic, no illustration, no anime, no cartoon`;
  }

  // Truncate to max 600 chars (safer limit)
  if (prompt.length > 600) {
    prompt = prompt.slice(0, 600);
    const lastSpace = prompt.lastIndexOf(' ');
    if (lastSpace > 400) prompt = prompt.slice(0, lastSpace);
  }

  console.log('Final image prompt:', prompt);

  const encoded = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 99999); // random seed = fresh image each time
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&nologo=true&seed=${seed}&model=flux`;

  console.log('Image URL length:', url.length);

  function applyImage(src) {
    img.src = src;
    img.style.opacity = '1';
    img.style.filter = 'none';
    img.style.transition = 'opacity 0.5s, filter 0.5s';
    img.style.cursor = 'zoom-in';
    img.onclick = () => openLightbox(src);
  }

  function tryLoad(src, attempt) {
    const t = new Image();
    // Pollinations can be slow — give it 30 seconds
    const timeout = setTimeout(() => {
      t.src = '';
      if (attempt < 3) {
        console.log('Image timeout, retry attempt', attempt + 1);
        const retrySeed = Math.floor(Math.random() * 99999);
        tryLoad(src.replace(/seed=\d+/, 'seed=' + retrySeed), attempt + 1);
      } else {
        // Final fallback — minimal prompt
        const fb = encodeURIComponent(name + ', ' + age + ' years old, portrait photo, natural light, photorealistic');
        applyImage(`https://image.pollinations.ai/prompt/${fb}?width=512&height=512&nologo=true&model=flux`);
      }
    }, 30000);
    t.onload = () => { clearTimeout(timeout); applyImage(src); };
    t.onerror = () => {
      clearTimeout(timeout);
      if (attempt < 3) {
        const retrySeed = Math.floor(Math.random() * 99999);
        tryLoad(src.replace(/seed=\d+/, 'seed=' + retrySeed), attempt + 1);
      } else {
        const fb = encodeURIComponent(name + ', ' + age + ' years old, portrait photo, natural light, photorealistic');
        applyImage(`https://image.pollinations.ai/prompt/${fb}?width=512&height=512&nologo=true&model=flux`);
      }
    };
    t.src = src;
  }

  tryLoad(url, 1);
}

// ─── LIGHTBOX ─────────────────────────────────────────────
function openLightbox(src) {
  let box = document.getElementById('hcLightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'hcLightbox';
    box.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'background:rgba(0,0,0,0.85)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'cursor:zoom-out', 'backdrop-filter:blur(6px)',
      'opacity:0', 'transition:opacity 0.25s'
    ].join(';');
    box.innerHTML = '<img style="max-width:90vw;max-height:90vh;border-radius:16px;' +
      'box-shadow:0 24px 80px rgba(0,0,0,0.6);object-fit:contain;" />';
    box.onclick = () => closeLightbox();
    document.body.appendChild(box);
  }
  box.querySelector('img').src = src;
  box.style.display = 'flex';
  requestAnimationFrame(() => { box.style.opacity = '1'; });
}

function closeLightbox() {
  const box = document.getElementById('hcLightbox');
  if (!box) return;
  box.style.opacity = '0';
  setTimeout(() => { box.style.display = 'none'; }, 250);
}

// ─── UTILS ────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('quizScreen').classList.contains('open')) quizNext();
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
});
function openWhereModal()  { document.getElementById('whereModal').classList.add('open'); }
function openWalletModal() { document.getElementById('walletModal').classList.add('open'); }
function closeModal(id)    { document.getElementById(id).classList.remove('open'); }

window.addEventListener('load', async () => {
  provider = detectProvider();
  if (provider) {
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      if (accounts.length > 0) {
        walletAddress = accounts[0];
        updateWalletBtn();
        if (!await isOnCorrectNetwork()) showNetworkBanner();
      }
    } catch(e) { console.warn('Auto-connect failed:', e.message); }
  }
});
