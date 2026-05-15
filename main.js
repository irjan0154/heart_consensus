// ─── CONFIG ───────────────────────────────────────────────
const CONTRACT_ADDRESS = '0xe82D69b5d0C66E19DED441Eb3c8787bf14cce571';
const GENLAYER_RPC     = 'https://studio.genlayer.com/api';
const CHAIN_ID         = 61999;
const CHAIN_ID_HEX     = '0xF22F';

// ─── GenLayer Calldata Encoding ───────────────────────────
// Source-accurate port of genlayer-js/src/abi/calldata/encoder.ts

const BITS_IN_TYPE = 3;
const TYPE_SPECIAL = 0;
const TYPE_PINT = 1;
const TYPE_NINT = 2;
const TYPE_BYTES = 3;
const TYPE_STR = 4;
const TYPE_ARR = 5;
const TYPE_MAP = 6;
const SPECIAL_NULL  = (0 << BITS_IN_TYPE) | TYPE_SPECIAL;
const SPECIAL_FALSE = (1 << BITS_IN_TYPE) | TYPE_SPECIAL;
const SPECIAL_TRUE  = (2 << BITS_IN_TYPE) | TYPE_SPECIAL;

function glWriteNum(to, data) {
  if (data === 0n) { to.push(0); return; }
  while (data > 0n) {
    let cur = Number(data & 0x7fn);
    data >>= 7n;
    if (data > 0n) cur |= 128;
    to.push(cur);
  }
}
function glEncodeNumWithType(to, data, type) {
  glWriteNum(to, (BigInt(data) << BigInt(BITS_IN_TYPE)) | BigInt(type));
}
function glEncodeNum(to, data) {
  if (data >= 0n) glEncodeNumWithType(to, data, TYPE_PINT);
  else glEncodeNumWithType(to, -data - 1n, TYPE_NINT);
}
function compareStr(l, r) {
  for (let i = 0; i < l.length && i < r.length; i++) {
    const d = l[i] - r[i]; if (d !== 0) return d;
  }
  return l.length - r.length;
}
function glEncodeMap(to, entries) {
  const sorted = Array.from(entries, ([k, v]) => {
    const kb = new TextEncoder().encode(k);
    return [Array.from(kb, c => c.codePointAt(0)), kb, v];
  }).sort((a, b) => compareStr(a[0], b[0]));
  glEncodeNumWithType(to, BigInt(sorted.length), TYPE_MAP);
  for (const [, kb, v] of sorted) {
    glWriteNum(to, BigInt(kb.length));
    for (const c of kb) to.push(c);
    glEncodeImpl(to, v);
  }
}
function glEncodeImpl(to, data) {
  if (data === null || data === undefined) { to.push(SPECIAL_NULL); return; }
  if (data === true)  { to.push(SPECIAL_TRUE);  return; }
  if (data === false) { to.push(SPECIAL_FALSE); return; }
  switch (typeof data) {
    case 'number':
      if (!Number.isInteger(data)) throw new Error('floats not supported');
      glEncodeNum(to, BigInt(data)); break;
    case 'bigint':
      glEncodeNum(to, data); break;
    case 'string': {
      const b = new TextEncoder().encode(data);
      glEncodeNumWithType(to, BigInt(b.length), TYPE_STR);
      for (const c of b) to.push(c);
      break;
    }
    case 'object':
      if (data instanceof Uint8Array) {
        glEncodeNumWithType(to, BigInt(data.length), TYPE_BYTES);
        for (const c of data) to.push(c);
      } else if (Array.isArray(data)) {
        glEncodeNumWithType(to, BigInt(data.length), TYPE_ARR);
        for (const c of data) glEncodeImpl(to, c);
      } else if (data instanceof Map) {
        glEncodeMap(to, data);
      } else {
        glEncodeMap(to, Object.entries(data));
      }
      break;
  }
}
function glEncode(data) {
  const arr = [];
  glEncodeImpl(arr, data);
  return new Uint8Array(arr);
}

// makeCalldataObject: {method, args} — same as genlayer-js
function makeCalldataObject(method, args) {
  const ret = {};
  if (method) ret['method'] = method;
  if (args && args.length > 0) ret['args'] = args;
  return ret;
}

// RLP encoding (viem-compatible minimal impl)
function rlpEncodeLength(len, offset) {
  if (len < 56) return [offset + len];
  const hex = len.toString(16);
  const padded = hex.length % 2 ? '0' + hex : hex;
  const lenBytes = padded.match(/.{2}/g).map(b => parseInt(b, 16));
  return [offset + 55 + lenBytes.length, ...lenBytes];
}
function rlpEncodeItem(bytes) {
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return [...rlpEncodeLength(bytes.length, 0x80), ...bytes];
}
function rlpEncodeList(items) {
  const encoded = items.flatMap(item => rlpEncodeItem(Array.from(item)));
  return new Uint8Array([...rlpEncodeLength(encoded.length, 0xc0), ...encoded]);
}

function toHex(bytes) {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// serialize([encodedCalldata, leaderOnly]) → RLP hex — same as genlayer-js
function glSerialize(encodedBytes, leaderOnly = false) {
  const item1 = encodedBytes;              // Uint8Array
  const item2 = leaderOnly                  // bool → 0x01 or 0x
    ? new Uint8Array([1])
    : new Uint8Array([]);
  return toHex(rlpEncodeList([item1, item2]));
}

// Full calldata hex for eth_sendTransaction (write calls)
function encodeGLCall(method, args) {
  const calldataObj = makeCalldataObject(method, args);
  const encoded = glEncode(calldataObj);
  return glSerialize(encoded, false);
}

// For gen_call (read-only), same encoding
function encodeGLRead(method, args) {
  return encodeGLCall(method, args);
}

// Decode GenLayer result: custom format → JS value → look for string
function glDecodeItem(bytes, idx) {
  if (idx.i >= bytes.length) return null;
  const first = bytes[idx.i];

  // Read LEB128-encoded tag
  let tag = 0n, shift = 0n;
  let shouldContinue = true;
  while (shouldContinue) {
    const b = bytes[idx.i++];
    tag += BigInt(b & 0x7f) << shift;
    shift += 7n;
    if ((b & 0x80) === 0) shouldContinue = false;
  }

  const type = Number(tag & 7n);
  const val  = tag >> 3n;

  switch (type) {
    case TYPE_SPECIAL: { // 0
      const s = Number(val);
      if (s === 0) return null;
      if (s === 1) return false;
      if (s === 2) return true;
      return null;
    }
    case TYPE_PINT: return Number(val);
    case TYPE_NINT: return -Number(val) - 1;
    case TYPE_BYTES: {
      const len = Number(val);
      const slice = bytes.slice(idx.i, idx.i + len);
      idx.i += len;
      return slice;
    }
    case TYPE_STR: {
      const len = Number(val);
      const slice = bytes.slice(idx.i, idx.i + len);
      idx.i += len;
      return new TextDecoder().decode(slice);
    }
    case TYPE_ARR: {
      const len = Number(val);
      const arr = [];
      for (let i = 0; i < len; i++) arr.push(glDecodeItem(bytes, idx));
      return arr;
    }
    case TYPE_MAP: {
      const len = Number(val);
      const map = {};
      for (let i = 0; i < len; i++) {
        // key: raw length-prefixed string (no type tag for key in map)
        let klen = 0n, kshift = 0n, kcont = true;
        while (kcont) {
          const b = bytes[idx.i++];
          klen += BigInt(b & 0x7f) << kshift;
          kshift += 7n;
          if ((b & 0x80) === 0) kcont = false;
        }
        const keyBytes = bytes.slice(idx.i, idx.i + Number(klen));
        idx.i += Number(klen);
        const key = new TextDecoder().decode(keyBytes);
        map[key] = glDecodeItem(bytes, idx);
      }
      return map;
    }
    default: return null;
  }
}

function decodeGLResult(hexStr) {
  if (!hexStr || hexStr === '0x') return null;
  try {
    const raw = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
    if (!raw) return null;
    const bytes = new Uint8Array(raw.match(/.{2}/g).map(b => parseInt(b, 16)));
    const idx = { i: 0 };
    const decoded = glDecodeItem(bytes, idx);
    console.log('decoded GL result:', decoded);

    // Result should be a string containing JSON
    if (typeof decoded === 'string') {
      const i = decoded.indexOf('{'), j = decoded.lastIndexOf('}');
      if (i !== -1 && j !== -1) return JSON.parse(decoded.slice(i, j + 1));
    }
    // Fallback: look for JSON in raw bytes
    let str = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    str = str.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
    const i = str.indexOf('{'), j = str.lastIndexOf('}');
    if (i !== -1 && j !== -1) return JSON.parse(str.slice(i, j + 1));
  } catch(e) {
    console.error('decodeGLResult error:', e);
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
  if (!window.ethereum) {
    alert('MetaMask not found. Please install MetaMask extension.');
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    walletAddress = accounts[0];
    await switchToGenLayer();
    closeModal('walletModal');
    updateWalletBtn();
  } catch (e) {
    console.error(e);
    alert('Could not connect wallet: ' + (e.message || e));
  }
}

async function switchToGenLayer() {
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CHAIN_ID_HEX }]
    });
  } catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: CHAIN_ID_HEX,
          chainName: 'GenLayer Studio',
          nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
          rpcUrls: [GENLAYER_RPC],
          blockExplorerUrls: ['https://explorer-studio.genlayer.com']
        }]
      });
    } else {
      throw e;
    }
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
  else { backBtn.textContent = '← Back'; backBtn.onclick = quizBack; }
  backBtn.style.opacity = '1';
  backBtn.style.pointerEvents = 'auto';
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
  else { submitToContract(); }
}

function quizBack() {
  if (current > 0) { current--; updateQuiz(); }
}

function goHome() {
  document.getElementById('quizScreen').classList.remove('open');
  document.getElementById('resultScreen').classList.remove('open');
  document.body.style.overflow = '';
  current = 0;
  answers.length = 0;
}

// ─── CONTRACT ─────────────────────────────────────────────

async function submitToContract() {
  document.getElementById('quizScreen').classList.remove('open');
  showWaiting();

  const argValues = [
    answers[0], answers[1], answers[2], answers[3], answers[4],
    answers[5], answers[6], answers[7], answers[8], answers[9]
  ];

  try {
    const txData = encodeGLCall('find_soulmate', argValues);
    console.log('Encoded calldata:', txData);

    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: walletAddress,
        to: CONTRACT_ADDRESS,
        data: txData,
        gas: '0x' + (300000).toString(16)
      }]
    });

    console.log('TX sent:', txHash);
    animateWaiting();
    await pollForResult(txHash);

  } catch (e) {
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
      // Primary: GenLayer RPC eth_getTransactionByHash
      const tx = await fetch(GENLAYER_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_getTransactionByHash', params:[txHash] })
      }).then(r => r.json());

      const status = tx?.result?.statusName;
      console.log('TX status:', status, '(attempt', attempt + ')');

      if (status === 'FINALIZED' || status === 'ACCEPTED') {
        clearInterval(interval);
        await fetchResult();
        return;
      }

      // Fallback: MetaMask receipt
      const receipt = await window.ethereum.request({
        method: 'eth_getTransactionReceipt',
        params: [txHash]
      });
      if (receipt && (receipt.status === '0x1' || receipt.statusName === 'FINALIZED')) {
        clearInterval(interval);
        await fetchResult();
        return;
      }

    } catch(e) {
      console.log('Polling error (attempt ' + attempt + '):', e.message);
    }

    if (attempt >= maxAttempts) {
      clearInterval(interval);
      hideWaiting();
      alert('Transaction is taking too long. Please check GenLayer Studio and try again.');
      goHome();
    }
  }, 3000);
}

async function fetchResult(retries = 8, delayMs = 4000) {
  // Wait for node to finalize state
  await new Promise(r => setTimeout(r, delayMs));

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const readData = encodeGLRead('get_last_match', []);
      const resp = await fetch(GENLAYER_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'gen_call',
          params: [{
            type: 'read',
            to: CONTRACT_ADDRESS,
            from: walletAddress,
            data: readData,
            transaction_hash_variant: 'latest-nonfinal'
          }]
        })
      }).then(r => r.json());

      console.log('gen_call response (attempt ' + attempt + '):', resp);

      if (resp?.error) {
        console.warn('RPC error:', resp.error);
        if (attempt < retries) { await new Promise(r => setTimeout(r, 3000)); continue; }
        throw new Error('RPC error: ' + (resp.error.message || JSON.stringify(resp.error)));
      }

      // extractGenCallResult: result is hex with first byte = status
      let hexData = resp?.result ?? '';
      if (typeof hexData === 'object') hexData = hexData?.data ?? '';
      console.log('raw result hex:', hexData);

      // Strip leading status byte if present (genlayer wraps result)
      if (hexData && hexData.length > 4) {
        // Try decoding as-is first, then strip 1 byte prefix
        let match = decodeGLResult(hexData);
        if (!match && hexData.startsWith('0x')) {
          // skip first byte (status prefix 0x01 = success)
          match = decodeGLResult('0x' + hexData.slice(4));
        }
        if (match) { hideWaiting(); showResult(match); return; }
      }

      if (attempt < retries) {
        console.warn('Could not parse result, retrying...');
        await new Promise(r => setTimeout(r, 3000));
      } else {
        throw new Error('Could not parse result after ' + retries + ' attempts: ' + JSON.stringify(resp));
      }

    } catch(e) {
      console.error('fetchResult error (attempt ' + attempt + '):', e);
      if (attempt >= retries) { hideWaiting(); alert('Could not fetch result: ' + e.message); goHome(); }
      else await new Promise(r => setTimeout(r, 3000));
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

function hideWaiting() {
  document.getElementById('waitingScreen').classList.remove('open');
}

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
  const imgUrl = `https://image.pollinations.ai/prompt/${imgPrompt}?width=400&height=400&nologo=true`;
  const img = document.getElementById('resultImage');
  img.src = imgUrl;
  img.style.display = 'block';

  document.getElementById('resultScreen').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// ─── UTILS ────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('quizScreen').classList.contains('open')) quizNext();
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
  }
});

function openWhereModal() { document.getElementById('whereModal').classList.add('open'); }
function openWalletModal() { document.getElementById('walletModal').classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

window.addEventListener('load', async () => {
  if (window.ethereum) {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length > 0) { walletAddress = accounts[0]; updateWalletBtn(); }
  }
});
