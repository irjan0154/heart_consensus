// v3
console.log("[HeartConsensus] main.js v3 loaded");
// ─── CONFIG ───────────────────────────────────────────────
const CONTRACT_ADDRESS = '0xe82D69b5d0C66E19DED441Eb3c8787bf14cce571';
const GENLAYER_RPC     = 'https://studio.genlayer.com/api';
const CHAIN_ID         = 61999;
const CHAIN_ID_HEX     = '0xF22F';

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
    console.log('result code:', raw[0], '| payload length:', raw.length - 1);
    if (raw[0] !== 0) {
      // Not a successful return — show error payload as text
      const msg = new TextDecoder().decode(raw.slice(1));
      console.warn('Contract error payload:', msg);
      return null;
    }
    const payload = raw.slice(1); // GL-encoded return value
    const str = glDecodeStr(payload);
    console.log('decoded result string:', str);
    const i = str.indexOf('{'), j = str.lastIndexOf('}');
    if (i !== -1 && j !== -1) return JSON.parse(str.slice(i, j + 1));
  } catch(e) {
    console.error('extractMatchFromResult error:', e);
  }
  return null;
}

// ─── STATE ────────────────────────────────────────────────
const questions = [
  "What's your age?",
  "How would your friends describe you in 3 words?",
  "What's your go-to hobby on a lazy Sunday?",
  "Any bad habits you're not ashamed of?",
  "What's your relationship with food?",
  "Night owl or early bird?",
  "What's your biggest green flag?",
  "What's your biggest red flag? (be honest)",
  "What's your ideal weekend — city or nature?",
  "Finish this sentence: My perfect partner must..."
];
let current = 0;
const answers = [];
let walletAddress = null;

// ─── WALLET ───────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) { alert('MetaMask not found. Please install MetaMask extension.'); return; }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    walletAddress = accounts[0];
    await switchToGenLayer();
    closeModal('walletModal');
    updateWalletBtn();
  } catch(e) { console.error(e); alert('Could not connect wallet: ' + (e.message || e)); }
}

async function switchToGenLayer() {
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] });
  } catch(e) {
    if (e.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: CHAIN_ID_HEX, chainName: 'GenLayer Studio',
          nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
          rpcUrls: [GENLAYER_RPC], blockExplorerUrls: ['https://explorer-studio.genlayer.com'] }]
      });
    } else throw e;
  }
}

function updateWalletBtn() {
  const btn = document.querySelector('.btn-wallet');
  if (walletAddress) {
    btn.textContent = walletAddress.slice(0,6) + '...' + walletAddress.slice(-4);
    btn.style.borderColor = 'rgba(232,82,122,0.4)';
    btn.style.color = '#E8527A';
  }
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
  else submitToContract();
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

  const argValues = answers.slice(0, 10);

  try {
    const txData = buildWriteCalldata('find_soulmate', argValues);
    console.log('TX calldata:', txData);

    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: walletAddress, to: CONTRACT_ADDRESS, data: txData, gas: '0x' + (300000).toString(16) }]
    });

    console.log('TX sent:', txHash);
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
      if (attempt === 1) console.log('RAW TX RESPONSE:', JSON.stringify(resp));

      const tx = resp?.result;
      // Try every possible status field location
      const status = tx?.statusName
        ?? tx?.status_name
        ?? tx?.status
        ?? tx?.consensus_data?.status
        ?? tx?.data?.status;

      console.log('TX status:', status, '| keys:', tx ? Object.keys(tx).join(',') : 'null', '(attempt', attempt + ')');

      const DONE = ['FINALIZED','ACCEPTED','7','5'];
      if (status !== undefined && status !== null && DONE.some(s => String(status) === s)) {
        clearInterval(interval);
        console.log('Full TX object:', JSON.stringify(tx, null, 2));

        // ── Strategy 1: extract result from leader_receipt in the TX itself ──
        const match = extractResultFromTx(tx);
        if (match) { hideWaiting(); showResult(match); return; }

        // ── Strategy 2: wait a bit and try gen_call ──
        await fetchResultViaGenCall(txHash);
        return;
      }

    } catch(e) { console.log('Polling error:', e.message); }

    if (attempt >= maxAttempts) {
      clearInterval(interval);
      hideWaiting();
      alert('Transaction is taking too long. Please check GenLayer Studio and try again.');
      goHome();
    }
  }, 3000);
}

function extractResultFromTx(tx) {
  try {
    // GenLayer puts consensus result in consensus_data.leader_receipt
    const leaderReceipt = tx?.consensus_data?.leader_receipt;
    if (!leaderReceipt) { console.log('No leader_receipt in TX'); return null; }

    const receipts = Array.isArray(leaderReceipt) ? leaderReceipt : [leaderReceipt];
    for (const r of receipts) {
      console.log('leader_receipt entry:', JSON.stringify(r));
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
        console.log('Found match in contract_state:', obj.name);
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
            type: 'read',
            to: CONTRACT_ADDRESS,
            from: walletAddress,
            data: buildReadCalldata('get_last_match', []),
            transaction_hash_variant: 'latest-nonfinal'
          }]
        })
      }).then(r => r.json());

      console.log('gen_call attempt', attempt, ':', JSON.stringify(resp));

      if (resp?.error) {
        console.warn('gen_call RPC error attempt ' + attempt + ':', resp.error?.message);
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
        console.log('gen_call decoded string:', str ? str.slice(0, 100) : 'null');
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
      if (attempt >= retries) { hideWaiting(); alert('Could not fetch result: ' + e.message); goHome(); }
      else await new Promise(r => setTimeout(r, 4000));
    }
  }
}

// ─── WAITING SCREEN ───────────────────────────────────────
const waitingMessages = [
  "Validators are reviewing your answers...",
  "Validator #1 is analyzing your personality...",
  "Validator #2 is checking compatibility...",
  "They're debating who's perfect for you...",
  "Validator #3 disagrees with the others...",
  "Arguments are getting heated...",
  "Consensus is being negotiated...",
  "Almost there — final vote in progress...",
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
  document.getElementById('resultName').textContent = match.name + ', ' + match.age;
  document.getElementById('resultTagline').textContent = match.tagline;
  document.getElementById('resultDescription').textContent = match.description;
  document.getElementById('resultCompatibility').textContent = match.compatibility_note;
  const imgPrompt = encodeURIComponent(match.image_prompt || match.name + ' portrait caricature style');
  const img = document.getElementById('resultImage');
  img.src = `https://image.pollinations.ai/prompt/${imgPrompt}?width=400&height=400&nologo=true`;
  img.style.display = 'block';
  document.getElementById('resultScreen').classList.add('open');
  document.body.style.overflow = 'hidden';
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
  if (window.ethereum) {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length > 0) { walletAddress = accounts[0]; updateWalletBtn(); }
  }
});
