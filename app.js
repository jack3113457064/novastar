// NovaStar DApp — 纯原生，零依赖，自动切BSC网络
const NOVA_ADDR = '0xA59bd1777e8eB5A20Ee51a6CF7C51aA31b6a18e5';
const STAKE_ADDR = '0x1611f15529148AB0C302Eed557d3C1F6e9918F18';
const BSC_CHAIN_ID = '0x38'; // 56

// 强制切换 BSC 网络（兼容手机钱包）
async function ensureBSC(){
  if(!window.ethereum) return alert('请用钱包内置浏览器打开此页面');
  const BSC = {
    chainId:'0x38',
    chainName:'BNB Smart Chain',
    rpcUrls:['https://bsc-rpc.publicnode.com','https://bsc-dataseed.binance.org/'],
    nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},
    blockExplorerUrls:['https://bscscan.com']
  };
  try {
    // 先检测当前链
    const chainId = await ethereum.request({method:'eth_chainId'}).catch(()=>'0x1');
    if(chainId === '0x38') return; // 已经是BSC
    // 尝试切换
    await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x38'}]}).catch(async()=>{
      // 钱包没BSC网络，添加
      await ethereum.request({method:'wallet_addEthereumChain',params:[BSC]});
    });
    // 再次确认
    const newChain = await ethereum.request({method:'eth_chainId'}).catch(()=>'0x1');
    if(newChain !== '0x38'){
      alert('请在钱包中手动切换到 BNB Smart Chain (BSC)\n\nMetaMask: 左上角选择网络\nTrust Wallet: 设置→网络→BSC\nTokenPocket: 我的→网络管理→BSC');
    }
  } catch(e){
    alert('网络切换失败。请手动在钱包中切换到 BNB Smart Chain\n\n错误: '+(e.message||'').substring(0,50));
  }
}

// 预计算的函数选择器 (keccak256 前4字节)
const SEL = {
  totalStaked: '0x817b1cd2',
  getUserStakeCount: '0x048d7753',
  stake: '0x7b0472f0',
  claim: '0x379607f5',
  approve: '0x095ea7b3',
  allowance: '0xdd62ed3e',
};

// ABI 编码工具
function pad64(hex){ return hex.toLowerCase().replace('0x','').padStart(64,'0'); }
function addr(a){ return pad64(a); }
function uint256(n){ return BigInt(n).toString(16).padStart(64,'0'); }

// 构造 eth_call / eth_sendTransaction 的 data
// stake(uint256,uint256) → SEL.stake + uint256(amount) + uint256(planSeconds)
function stakeData(amount, planSec){ return SEL.stake + uint256(amount) + uint256(planSec); }
function claimData(idx){ return SEL.claim + uint256(idx); }
function approveData(spender, amount){ return SEL.approve + addr(spender) + uint256(amount); }
function allowanceData(owner, spender){ return SEL.allowance + addr(owner) + addr(spender); }
function stakeCountData(user){ return SEL.getUserStakeCount + addr(user); }

// RPC 调用
async function rpc(method, params){
  const r = await fetch('https://bsc-rpc.publicnode.com', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0',id:1,method,params})
  });
  const j = await r.json();
  if(j.error) throw new Error(j.error.message);
  return j.result;
}
function decodeUint(hex){ try { return BigInt(hex); } catch(e){ return 0n; } }

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
  } catch(e) { console.log('Price load error'); }
}

// ====== Staking ======
async function loadStakeInfo(){
  try {
    const ts = decodeUint(await rpc('eth_call',[{to:STAKE_ADDR,data:SEL.totalStaked},'latest']));
    document.getElementById('totalStaked').textContent = (Number(ts)/1e18/1e6).toFixed(1)+'M';

    if(window.ethereum){
      await ensureBSC();
      const acc = (await ethereum.request({method:'eth_requestAccounts'}))[0];
      if(!acc) return;
      const count = Number(decodeUint(await rpc('eth_call',[{to:STAKE_ADDR,data:stakeCountData(acc)},'latest'])));
      document.getElementById('myStakes').innerHTML = count > 0
        ? '你有 <b>'+count+'</b> 笔质押。切换到钱包App操作提取。'
        : '暂无质押记录';
    }
  } catch(e) { console.log(e); }
}

async function doStake(){
  if(!window.ethereum) return alert('请用钱包App内置浏览器打开！\n\nTrust Wallet → DApps → 输入官网地址');
  try {
    await ensureBSC();
    const acc = (await ethereum.request({method:'eth_requestAccounts'}))[0];
    const amt = document.getElementById('stakeAmount').value;
    if(!amt || parseFloat(amt)<=0) return alert('请输入数量');
    const planDay = parseInt(document.getElementById('plan').value);
    const amtWei = BigInt(Math.floor(parseFloat(amt)*1e18));
    const planSec = planDay * 86400;

    // 检查授权
    const allowHex = await rpc('eth_call',[{to:NOVA_ADDR,data:allowanceData(acc,STAKE_ADDR)},'latest']);
    if(decodeUint(allowHex) < amtWei){
      document.getElementById('stakeMsg').textContent = '🔓 请在钱包确认授权...';
      await ethereum.request({method:'eth_sendTransaction',params:[{
        from:acc, to:NOVA_ADDR,
        data: approveData(STAKE_ADDR, '999000000'+'0'.repeat(18)),
        gas: '0x186A0'
      }]});
      document.getElementById('stakeMsg').textContent = '✅ 已授权，正在质押...';
    }

    document.getElementById('stakeMsg').textContent = '🔒 请在钱包确认质押...';
    const hash = await ethereum.request({method:'eth_sendTransaction',params:[{
      from:acc, to:STAKE_ADDR,
      data: stakeData(amtWei.toString(), planSec.toString()),
      gas: '0x2DC6C0'
    }]});
    document.getElementById('stakeMsg').innerHTML = '✅ 质押成功！<br><small>TX: '+hash.substring(0,24)+'...</small>';
    setTimeout(loadStakeInfo, 5000);
  } catch(e) {
    if(e.code === 4001) document.getElementById('stakeMsg').textContent = '❌ 你取消了交易';
    else document.getElementById('stakeMsg').textContent = '❌ '+(e.message||'').substring(0,80);
  }
}

async function doClaim(idx){
  if(!window.ethereum) return;
  try {
    await ensureBSC();
    const acc = (await ethereum.request({method:'eth_requestAccounts'}))[0];
    document.getElementById('claimMsg').textContent = '领取中...';
    const hash = await ethereum.request({method:'eth_sendTransaction',params:[{
      from:acc, to:STAKE_ADDR,
      data: claimData(idx),
      gas: '0x2DC6C0'
    }]});
    document.getElementById('claimMsg').innerHTML = '✅ TX: '+hash.substring(0,24)+'...';
    setTimeout(loadStakeInfo, 5000);
  } catch(e) {
    if(e.code === 4001) document.getElementById('claimMsg').textContent = '❌ 你取消了交易';
    else document.getElementById('claimMsg').textContent = '❌ '+(e.message||'').substring(0,80);
  }
}

// 公开的切换BSC函数
async function switchToBSC(){
  try {
    await ensureBSC();
    document.getElementById('netWarn').style.display = 'none';
    alert('✅ 已切换到 BSC 网络！');
  } catch(e){
    alert('切换失败，请手动在钱包中切换到 BNB Smart Chain');
  }
}

// Init — 页面加载即检查网络
loadPrice(); setInterval(loadPrice, 30000);
(async function initNetwork(){
  if(window.ethereum){
    // 监听网络切换
    ethereum.on('chainChanged', () => location.reload());
    // 延迟检查
    setTimeout(async ()=>{
      try {
        const chainId = await ethereum.request({method:'eth_chainId'});
        if(chainId !== BSC_CHAIN_ID){
          document.getElementById('netWarn').style.display = 'block';
        }
      } catch(e){}
    }, 500);
  }
})();
