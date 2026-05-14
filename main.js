// ─── CONFIG ───────────────────────────────────────────────
const CONTRACT_ADDRESS = '0xe82D69b5d0C66E19DED441Eb3c8787bf14cce571';
const GENLAYER_RPC     = 'https://studio.genlayer.com/api';
const CHAIN_ID         = 61999;
const CHAIN_ID_HEX     = '0xF22F';

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
function encodeStr(str) {
  const bytes = new TextEncoder().encode(str);
  const lenHex = bytes.length.toString(16).padStart(4, '0');
  const dataHex = Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join('');
  return lenHex + dataHex;
}

function buildCalldata(args) {
  // GenLayer calldata: method name + list of string args
  const methodName = 'find_soulmate';
  let data = '0x';
  // method selector: simple RLP-like encoding used by GenLayer
  // Use their ABI format: first byte = num args, then each string length-prefixed
  const numArgs = args.length;
  data += numArgs.toString(16).padStart(2, '0');
  // method name
  data += encodeStr(methodName);
  // args
  for (const arg of args) {
    data += encodeStr(arg);
  }
  return data;
}

async function submitToContract() {
  document.getElementById('quizScreen').classList.remove('open');
  showWaiting();

  const argValues = [
    answers[0], answers[1], answers[2], answers[3], answers[4],
    answers[5], answers[6], answers[7], answers[8], answers[9]
  ];

  try {
    // Encode using GenLayer's JSON-RPC format
    const params = {
      from: walletAddress,
      to: CONTRACT_ADDRESS,
      data: buildGenLayerTx('find_soulmate', argValues)
    };

    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [params]
    });

    animateWaiting();
    await pollForResult(txHash);

  } catch (e) {
    console.error(e);
    hideWaiting();
    alert('Transaction failed: ' + (e.message || e));
    goHome();
  }
}

function buildGenLayerTx(method, args) {
  // GenLayer uses msgpack-style encoding
  // Simplest approach: encode as JSON string in hex
  const payload = JSON.stringify({ method, args });
  return '0x' + Array.from(new TextEncoder().encode(payload))
    .map(b => b.toString(16).padStart(2,'0')).join('');
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
    // Call get_last_match view method
    const callPayload = JSON.stringify({ method: 'get_last_match', args: [] });
    const callHex = '0x' + Array.from(new TextEncoder().encode(callPayload))
      .map(b => b.toString(16).padStart(2,'0')).join('');

    const resp = await fetch(GENLAYER_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'eth_call',
        params: [{ from: walletAddress, to: CONTRACT_ADDRESS, data: callHex }, 'latest']
      })
    }).then(r => r.json());

    let resultStr = resp?.result || '';
    // decode hex result
    if (resultStr.startsWith('0x')) {
      resultStr = new TextDecoder().decode(
        new Uint8Array(resultStr.slice(2).match(/.{2}/g).map(b => parseInt(b,16)))
      );
    }
    resultStr = resultStr.replace(/[^\x20-\x7E\u0400-\u04FF]/g, '').trim();
    const jsonStart = resultStr.indexOf('{');
    if (jsonStart !== -1) resultStr = resultStr.slice(jsonStart);

    const match = JSON.parse(resultStr);
    hideWaiting();
    showResult(match);

  } catch(e) {
    console.error(e);
    hideWaiting();
    alert('Could not fetch result. Check GenLayer Studio.');
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
