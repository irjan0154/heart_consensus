// ─── CONFIG ───────────────────────────────────────────────
const CONTRACT_ADDRESS = '0xe82D69b5d0C66E19DED441Eb3c8787bf14cce571';
const GENLAYER_RPC     = 'https://studio.genlayer.com/api';
const CHAIN_ID         = 61999;
const CHAIN_ID_HEX     = '0xF22F';

// ─── GenLayer encoding helpers ────────────────────────────
// Minimal msgpack encoder (GenLayer uses msgpack for calldata)
function msgpackEncode(value) {
  const bytes = [];

  function writeBytes(arr) { for (const b of arr) bytes.push(b); }

  function encode(val) {
    if (val === null || val === undefined) {
      bytes.push(0xc0); // nil
    } else if (typeof val === 'boolean') {
      bytes.push(val ? 0xc3 : 0xc2);
    } else if (typeof val === 'number' && Number.isInteger(val)) {
      if (val >= 0 && val <= 0x7f) {
        bytes.push(val);
      } else if (val >= -32 && val < 0) {
        bytes.push(0xe0 | (val + 32));
      } else if (val >= 0 && val <= 0xff) {
        bytes.push(0xcc, val);
      } else if (val >= 0 && val <= 0xffff) {
        bytes.push(0xcd, (val >> 8) & 0xff, val & 0xff);
      } else {
        bytes.push(0xce,
          (val >>> 24) & 0xff, (val >>> 16) & 0xff,
          (val >>> 8) & 0xff, val & 0xff);
      }
    } else if (typeof val === 'string') {
      const enc = new TextEncoder().encode(val);
      const len = enc.length;
      if (len <= 31) {
        bytes.push(0xa0 | len);
      } else if (len <= 0xff) {
        bytes.push(0xd9, len);
      } else if (len <= 0xffff) {
        bytes.push(0xda, (len >> 8) & 0xff, len & 0xff);
      } else {
        bytes.push(0xdb,
          (len >>> 24) & 0xff, (len >>> 16) & 0xff,
          (len >>> 8) & 0xff, len & 0xff);
      }
      writeBytes(enc);
    } else if (Array.isArray(val)) {
      const len = val.length;
      if (len <= 15) bytes.push(0x90 | len);
      else if (len <= 0xffff) bytes.push(0xdc, (len >> 8) & 0xff, len & 0xff);
      else bytes.push(0xdd, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff);
      for (const item of val) encode(item);
    } else if (typeof val === 'object') {
      const keys = Object.keys(val);
      const len = keys.length;
      if (len <= 15) bytes.push(0x80 | len);
      else if (len <= 0xffff) bytes.push(0xde, (len >> 8) & 0xff, len & 0xff);
      else bytes.push(0xdf, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff);
      for (const k of keys) { encode(k); encode(val[k]); }
    }
  }

  encode(value);
  return new Uint8Array(bytes);
}

// Encodes a GenLayer contract method call into calldata hex (msgpack format)
function encodeGLCall(method, args) {
  // GenLayer calldata: msgpack array [method_name, ...args]
  const payload = [method, ...args];
  const encoded = msgpackEncode(payload);
  return '0x' + Array.from(encoded).map(b => b.toString(16).padStart(2, '0')).join('');
}

function decodeGLResult(hexStr) {
  // Strip 0x, decode bytes, find JSON
  if (!hexStr || hexStr === '0x') return null;
  const raw = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
  const bytes = new Uint8Array(raw.match(/.{2}/g).map(b => parseInt(b, 16)));
  let str = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // remove non-printable except whitespace
  str = str.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
  const i = str.indexOf('{');
  const j = str.lastIndexOf('}');
  if (i === -1 || j === -1) return null;
  return JSON.parse(str.slice(i, j + 1));
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
    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: walletAddress,
        to: CONTRACT_ADDRESS,
        data: encodeGLCall('find_soulmate', argValues),
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
  const maxAttempts = 60;
  let attempt = 0;

  const interval = setInterval(async () => {
    attempt++;
    updateWaitingMessage(attempt);

    try {
      const receipt = await window.ethereum.request({
        method: 'eth_getTransactionReceipt',
        params: [txHash]
      });

      if (receipt && (receipt.status === '0x1' || receipt.statusName === 'FINALIZED' || receipt.statusName === 'ACCEPTED')) {
        clearInterval(interval);
        await fetchResult();
        return;
      }

      // Also try GenLayer-specific RPC
      const tx = await fetch(GENLAYER_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_getTransactionByHash', params:[txHash] })
      }).then(r => r.json());

      const status = tx?.result?.statusName;
      if (status === 'FINALIZED' || status === 'ACCEPTED') {
        clearInterval(interval);
        await fetchResult();
      }

    } catch(e) {
      console.log('Polling...', attempt);
    }

    if (attempt >= maxAttempts) {
      clearInterval(interval);
      hideWaiting();
      alert('Transaction is taking too long. Please check GenLayer Studio and try again.');
      goHome();
    }
  }, 3000);
}

async function fetchResult(retries = 5, delayMs = 3000) {
  // Small delay to let the node finalize state after consensus
  await new Promise(r => setTimeout(r, delayMs));

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(GENLAYER_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'gen_call',
          params: [{
            from: walletAddress,
            to: CONTRACT_ADDRESS,
            data: encodeGLCall('get_last_match', []),
            type: 'read',
            value: '0x0'
          }]
        })
      }).then(r => r.json());

      console.log('gen_call response (attempt ' + attempt + '):', resp);

      // If RPC returned an error object, log and retry
      if (resp?.error) {
        console.warn('RPC error:', resp.error);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw new Error('RPC error: ' + (resp.error.message || JSON.stringify(resp.error)));
      }

      // result can be hex string directly, or an object with .data
      const hexData = resp?.result?.data ?? resp?.result ?? '';
      console.log('hexData:', hexData);

      const match = decodeGLResult(hexData);

      if (!match) {
        if (attempt < retries) {
          console.warn('Could not parse result, retrying...', hexData);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw new Error('Could not parse result: ' + JSON.stringify(resp));
      }

      hideWaiting();
      showResult(match);
      return;

    } catch(e) {
      console.error('fetchResult error (attempt ' + attempt + '):', e);
      if (attempt >= retries) {
        hideWaiting();
        alert('Could not fetch result: ' + e.message);
        goHome();
      } else {
        await new Promise(r => setTimeout(r, 3000));
      }
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

function animateWaiting() {
  // dots animation is CSS-based
}

// ─── RESULT SCREEN ────────────────────────────────────────
function showResult(match) {
  document.getElementById('resultName').textContent = match.name + ', ' + match.age;
  document.getElementById('resultTagline').textContent = match.tagline;
  document.getElementById('resultDescription').textContent = match.description;
  document.getElementById('resultCompatibility').textContent = match.compatibility_note;

  // Generate image via Pollinations
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

// Check if already connected
window.addEventListener('load', async () => {
  if (window.ethereum) {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length > 0) {
      walletAddress = accounts[0];
      updateWalletBtn();
    }
  }
});
