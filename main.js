// ─── CONFIG ───────────────────────────────────────────────
const CONTRACT_ADDRESS = '0xe82D69b5d0C66E19DED441Eb3c8787bf14cce571';
const GENLAYER_RPC     = 'https://studio.genlayer.com/api';
const CHAIN_ID         = 61999;
const CHAIN_ID_HEX     = '0xF22F';

// ─── GenLayer encoding helpers ────────────────────────────
// Encodes method call into GenLayer calldata hex
// Format mirrors what GenLayer Studio sends (msgpack-inspired)
function encodeGLCall(method, args) {
  // Build a simple length-prefixed binary format:
  // [1 byte: num_args][2 bytes: method_len][method_bytes][for each arg: 2 bytes len + bytes]
  const enc = new TextEncoder();
  const methodBytes = enc.encode(method);
  const argBufs = args.map(a => enc.encode(String(a)));

  let totalLen = 1 + 2 + methodBytes.length;
  for (const b of argBufs) totalLen += 2 + b.length;

  const buf = new Uint8Array(totalLen);
  let off = 0;

  buf[off++] = args.length; // num args

  // method name
  buf[off++] = (methodBytes.length >> 8) & 0xff;
  buf[off++] = methodBytes.length & 0xff;
  buf.set(methodBytes, off); off += methodBytes.length;

  // each arg
  for (const b of argBufs) {
    buf[off++] = (b.length >> 8) & 0xff;
    buf[off++] = b.length & 0xff;
    buf.set(b, off); off += b.length;
  }

  return '0x' + Array.from(buf).map(b => b.toString(16).padStart(2,'0')).join('');
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

async function fetchResult() {
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

    console.log('gen_call response:', resp);

    // result.data contains the hex-encoded return value
    const hexData = resp?.result?.data || resp?.result || '';
    const match = decodeGLResult(hexData);

    if (!match) throw new Error('Could not parse result: ' + JSON.stringify(resp));

    hideWaiting();
    showResult(match);

  } catch(e) {
    console.error('fetchResult error:', e);
    hideWaiting();
    alert('Could not fetch result: ' + e.message);
    goHome();
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
