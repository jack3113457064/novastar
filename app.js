// NovaStar DApp v4 — 完整质押详情+提取
const NOVA_ADDR = '0xA59bd1777e8eB5A20Ee51a6CF7C51aA31b6a18e5';
const STAKE_ADDR = '0x1611f15529148AB0C302Eed557d3C1F6e9918F18';
const RPC_URL = 'https://bsc-rpc.publicnode.com';
const BSC_ID = '0x38';

let provider, signer, userAddr;
let ethersReady = false;

// 加载 ethers（国内CDN + 备用）
function loadEthers(cb){
  if(typeof ethers !== 'undefined'){ ethersReady=true; cb(); return; }
  var s = document.createElement('script');
  s.src = 'https://cdn.bootcdn.net/ajax/libs/ethers/6.13.0/ethers.umd.min.js';
  s.onload = function(){ ethersReady=true; cb(); };
  s.onerror = function(){
    // 备用CDN
    s.src = 'https://unpkg.com/ethers@6.13.0/dist/ethers.umd.min.js';
    document.head.appendChild(s);
  };
  document.head.appendChild(s);
}

// ====== 网络切换 ======
async function switchToBSC(){
  if(!window.ethereum) return alert('请用钱包内置浏览器打开');
  try {
    await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:BSC_ID}]}).catch(async()=>{
      await ethereum.request({method:'wallet_addEthereumChain',params:[{
        chainId:BSC_ID, chainName:'BNB Smart Chain',
        rpcUrls:[RPC_URL,'https://bsc-dataseed.binance.org/'],
        nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},
        blockExplorerUrls:['https://bscscan.com']
      }]});
    });
    document.getElementById('netWarn').style.display = 'none';
    initWallet();
  } catch(e){ alert('请手动在钱包切换到 BSC 网络'); }
}

// ====== 钱包初始化 ======
async function initWallet(){
  if(!ethersReady || !window.ethereum) return;
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    const chainId = await ethereum.request({method:'eth_chainId'});
    if(chainId !== BSC_ID){
      document.getElementById('netWarn').style.display = 'block';
      return;
    }
    document.getElementById('netWarn').style.display = 'none';
    signer = await provider.getSigner();
    userAddr = await signer.getAddress();
    document.getElementById('walletAddr').textContent = userAddr.substring(0,8)+'...'+userAddr.substring(38);
    document.getElementById('walletStatus').style.display = 'block';
    loadStakeInfo();
  } catch(e){ console.log(e); }
}

// ====== Dashboard ======
async function loadPrice(){
  try {
    const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/'+NOVA_ADDR);
    const d = await r.json();
    if(d.pairs?.length>0){
      const p = d.pairs.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
      const price = parseFloat(p.priceUsd);
      document.getElementById('price').textContent = price < 0.0001 ? '$'+price.toExponential(2) : '$'+price.toFixed(6);
      document.getElementById('liquidity').textContent = '$'+Math.round(p.liquidity?.usd||0);
      document.getElementById('volume24').textContent = '$'+Math.round(p.volume?.h24||0);
    }
  } catch(e) {}
}

// ====== Staking ======
async function loadStakeInfo(){
  if(!signer) return;
  try {
    const rpc = new ethers.JsonRpcProvider(RPC_URL);
    const stake = new ethers.Contract(STAKE_ADDR, [
      'function totalStaked() view returns (uint256)',
      'function getUserStakeCount(address) view returns (uint256)',
      'function getUserStakes(address) view returns (tuple(uint256,uint256,uint256,bool)[])',
    ], rpc);

    const ts = await stake.totalStaked();
    document.getElementById('totalStaked').textContent = (Number(ethers.formatEther(ts))/1e6).toFixed(1)+'M';

    const count = Number(await stake.getUserStakeCount(userAddr));
    if(count === 0){ document.getElementById('myStakes').innerHTML = '<p style=color:#889>暂无质押记录</p>'; return; }

    const all = await stake.getUserStakes(userAddr);
    let html = '';
    for(let i=0;i<count;i++){
      const s = all[i];
      const amount = Number(ethers.formatEther(s[0]));
      const unlock = new Date(Number(s[1])*1000);
      const rewardRate = Number(s[2])/100;
      const reward = amount * rewardRate / 100;
      const now = Date.now()/1000;
      const unlocked = now >= Number(s[1]);
      const claimed = s[3];

      html += '<div class="info-row" style="padding:12px;'+(unlocked&&!claimed?'background:rgba(39,174,96,0.1);border-radius:8px;':'')+'">';
      html += '<div><b>'+amount.toLocaleString()+' NOVA</b><br><small style=color:#889>到期: '+unlock.toLocaleDateString()+' | 收益: '+rewardRate.toFixed(1)+'% (+'+reward.toLocaleString()+' NOVA)</small></div>';
      if(claimed){
        html += '<span style=color:#27ae60>✅ 已提取</span>';
      } else if(unlocked){
        html += '<button class=btn style=\"padding:8px 18px;font-size:14px\" onclick=\"doClaim('+i+')\">📤 提取 '+(amount+reward).toLocaleString()+' NOVA</button>';
      } else {
        const days = Math.ceil((Number(s[1])-now)/86400);
        html += '<span style=color:#f0ad4e>🔒 '+days+'天后解锁</span>';
      }
      html += '</div>';
    }
    document.getElementById('myStakes').innerHTML = html;
  } catch(e){ console.log(e); }
}

async function doStake(){
  if(!signer) return alert('请先连接钱包');
  try {
    const amt = document.getElementById('stakeAmount').value;
    if(!amt||parseFloat(amt)<=0) return alert('请输入数量');
    const planDay = parseInt(document.getElementById('plan').value);

    const nova = new ethers.Contract(NOVA_ADDR, [
      'function approve(address,uint256) returns (bool)',
      'function allowance(address,address) view returns (uint256)',
    ], signer);

    const stake = new ethers.Contract(STAKE_ADDR, [
      'function stake(uint256,uint256)',
    ], signer);

    const amtWei = ethers.parseEther(amt);

    // 检查授权
    const allow = await nova.allowance(userAddr, STAKE_ADDR);
    if(allow < amtWei){
      document.getElementById('stakeMsg').textContent = '🔓 请在钱包确认授权...';
      const tx = await nova.approve(STAKE_ADDR, ethers.parseEther('999000000'));
      await tx.wait();
    }

    document.getElementById('stakeMsg').textContent = '🔒 请在钱包确认质押...';
    const tx = await stake.stake(amtWei, planDay*86400);
    await tx.wait();
    document.getElementById('stakeMsg').innerHTML = '✅ 质押成功！';
    loadStakeInfo();
  } catch(e){
    if(e.code===4001) document.getElementById('stakeMsg').textContent = '❌ 取消了交易';
    else document.getElementById('stakeMsg').textContent = '❌ '+(e.shortMessage||e.message||'').substring(0,60);
  }
}

async function doClaim(idx){
  if(!signer) return;
  try {
    document.getElementById('claimMsg').textContent = '领取中...';
    const stake = new ethers.Contract(STAKE_ADDR, ['function claim(uint256)'], signer);
    const tx = await stake.claim(idx);
    await tx.wait();
    document.getElementById('claimMsg').innerHTML = '✅ 领取成功！';
    loadStakeInfo();
  } catch(e){
    if(e.code===4001) document.getElementById('claimMsg').textContent = '❌ 取消了交易';
    else document.getElementById('claimMsg').textContent = '❌ '+(e.shortMessage||e.message||'').substring(0,60);
  }
}

// 页面切换
function switchTab(tab){
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById(tab).classList.add('active');
  event.target.classList.add('active');
  if(tab==='dashboard') loadPrice();
  if(tab==='stake' && ethersReady) { initWallet(); loadStakeInfo(); }
}

// Init
loadPrice(); setInterval(loadPrice, 30000);
loadEthers(function(){
  if(window.ethereum){ initWallet(); }
  // 网络切换监听
  if(window.ethereum) ethereum.on('chainChanged', ()=>location.reload());
});
