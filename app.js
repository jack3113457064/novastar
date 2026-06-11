// NovaStar DApp v5 — 纯原生 JS，零外部依赖
const NOVA = '0xA59bd1777e8eB5A20Ee51a6CF7C51aA31b6a18e5';
const STAKE = '0x1611f15529148AB0C302Eed557d3C1F6e9918F18';
const RPC = 'https://bsc-rpc.publicnode.com';

// ====== RPC 调用 ======
async function rpcCall(method, params){
  const r = await fetch(RPC, {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const j = await r.json();
  if(j.error) throw new Error(j.error.message);
  return j.result;
}

// ====== ABI 编码（预计算选择器） ======
function pad64(h){ return h.replace('0x','').toLowerCase().padStart(64,'0'); }
function addr(a){ return pad64(a); }
function u256(n){ return BigInt(n).toString(16).padStart(64,'0'); }

// 函数选择器
const SIG = {
  totalStaked: '0x817b1cd2',
  getUserStakes: '0x842e2981',   // getUserStakes(address)
  stakeCount: '0x048d7753',       // getUserStakeCount(address)
  stake: '0x7b0472f0',           // stake(uint256,uint256)
  claim: '0x379607f5',           // claim(uint256)
  balanceOf: '0x70a08231',       // balanceOf(address)
  approve: '0x095ea7b3',         // approve(address,uint256)
  allowance: '0xdd62ed3e',       // allowance(address,address)
  balanceOf: '0x70a08231',       // balanceOf(address)
};

function encStakeCount(user){ return SIG.stakeCount + addr(user); }
function encStakes(user){ return SIG.getUserStakes + addr(user); }
function encStake(amt,plan){ return SIG.stake + u256(amt) + u256(plan); }
function encClaim(idx){ return SIG.claim + u256(idx); }
function encApprove(sp,amt){ return SIG.approve + addr(sp) + u256(amt); }
function encAllowance(owner,sp){ return SIG.allowance + addr(owner) + addr(sp); }

// ====== ABI 解码 ======
function decUint256(hex, offset){
  const start = 2 + offset*64;
  return BigInt('0x' + hex.substring(start, start+64));
}
function decBool(hex, offset){
  const start = 2 + offset*64;
  return hex.substring(start+62, start+64) !== '00';
}
function decArrayLen(hex, dataOffset){
  return Number(decUint256(hex, dataOffset));
}

// 解码 getUserStakes 返回的 tuple(uint256,uint256,uint256,bool)[]
function decodeStakes(hex){
  if(!hex || hex==='0x') return [];
  // 第一个32字节是数组偏移量（相对于数据开始位置）
  const arrOffset = Number(decUint256(hex, 0)); // 偏移量
  const totalOffset = arrOffset; // 这是相对于整个hex的位置
  const len = Number(decUint256(hex, totalOffset));
  const result = [];
  for(let i=0; i<len; i++){
    const base = totalOffset + 1 + i*4; // +1 for length, each tuple = 4 words
    result.push({
      amount: decUint256(hex, base),
      unlockTime: Number(decUint256(hex, base+1)),
      rewardRate: Number(decUint256(hex, base+2)),
      claimed: decBool(hex, base+3)
    });
  }
  return result;
}

// ====== 网络切换 ======
async function switchToBSC(){
  if(!window.ethereum) return alert('请使用钱包内置浏览器打开');
  try {
    await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x38'}]}).catch(async()=>{
      await ethereum.request({method:'wallet_addEthereumChain',params:[{
        chainId:'0x38', chainName:'BNB Smart Chain',
        rpcUrls:[RPC,'https://bsc-dataseed.binance.org/'],
        nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},
        blockExplorerUrls:['https://bscscan.com']
      }]});
    });
    document.getElementById('netWarn').style.display = 'none';
    location.reload();
  } catch(e){ alert('请手动在钱包中切换 BSC 网络'); }
}

// ====== Dashboard ======
async function loadPrice(){
  try {
    const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/'+NOVA);
    const d = await r.json();
    if(d.pairs?.length>0){
      const p = d.pairs.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
      const price = parseFloat(p.priceUsd);
      document.getElementById('price').textContent = price < 0.0001 ? '$'+price.toExponential(2) : '$'+price.toFixed(6);
      document.getElementById('liquidity').textContent = '$'+Math.round(p.liquidity?.usd||0);
      document.getElementById('volume24').textContent = '$'+Math.round(p.volume?.h24||0);
      document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
    }
  } catch(e) {}
}

async function loadHolders(){
  try {
    // 已知持仓地址 + BscScan余额检查
    const addrs = [
      '0xe5DEDf734f8101442f9fCc50cB6988dC2CD85c90',
      '0xc272333190C49cefa73017Fa58d392819D9E0Cc0',
      '0xa7415a9a46ee69686C11bA28789489fC1949469a',
      '0x89173268c43DAa73F82668bc98D57a509683277B',
      '0x1611f15529148AB0C302Eed557d3C1F6e9918F18',
      '0x000000000000000000000000000000000000dEaD',
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      '0x70a2B59fabcD58FfE83FA06A08Bc77Fac6498eE6',
      '0x1F25E2665a5A29c798FfB3f0a9CEAA8aba294AE7',
    ];
    let count = 0;
    for(let addr of addrs){
      const hex = await rpcCall('eth_call',[{to:NOVA,data:SIG.balanceOf+addr(addr)},'latest']);
      if(BigInt(hex) > 0n) count++;
    }
    document.getElementById('holders').textContent = count;
  } catch(e){}
}

// ====== Staking ======
async function loadStakeInfo(){
  if(!window.ethereum) return;
  try {
    // 加载总质押
    const ts = decUint256(await rpcCall('eth_call',[{to:STAKE,data:SIG.totalStaked},'latest']), 0);
    document.getElementById('totalStaked').textContent = (Number(ts)/1e18/1e6).toFixed(1)+'M';

    // 获取用户地址
    const accs = await ethereum.request({method:'eth_requestAccounts'}).catch(()=>[]);
    if(!accs.length) return;
    const user = accs[0];
    document.getElementById('walletAddr').textContent = user.substring(0,8)+'...'+user.substring(38);
    document.getElementById('walletStatus').style.display = 'block';

    // 检查BSC网络
    try {
      const cid = await ethereum.request({method:'eth_chainId'});
      if(cid !== '0x38'){ document.getElementById('netWarn').style.display='block'; return; }
      document.getElementById('netWarn').style.display='none';
    } catch(e){}

    // 获取质押数量
    const countHex = await rpcCall('eth_call',[{to:STAKE,data:encStakeCount(user)},'latest']);
    const count = Number(decUint256(countHex,0));

    if(count === 0){
      document.getElementById('myStakes').innerHTML = '<p style=color:#889>暂无质押记录</p>';
      return;
    }

    // 获取质押详情
    const stakesHex = await rpcCall('eth_call',[{to:STAKE,data:encStakes(user)},'latest']);
    const stakes = decodeStakes(stakesHex);

    let html = '';
    for(let i=0; i<stakes.length; i++){
      const s = stakes[i];
      const amount = Number(s.amount)/1e18;
      const unlock = new Date(s.unlockTime*1000);
      const rate = s.rewardRate/100;
      const reward = amount * rate / 100;
      const now = Math.floor(Date.now()/1000);
      const unlocked = now >= s.unlockTime;
      const claimed = s.claimed;
      const total = amount + reward;

      html += '<div style="padding:12px;margin:8px 0;background:rgba(255,255,255,0.03);border-radius:10px;'+(unlocked&&!claimed?'border:2px solid #27ae60;':'')+'">';
      html += '<div style=font-size:18px;font-weight:bold>'+amount.toLocaleString()+' NOVA</div>';
      html += '<div style=font-size:13px;color:#889>到期: '+unlock.toLocaleDateString()+' | 收益: '+rate.toFixed(1)+'% = +'+reward.toLocaleString()+' NOVA</div>';
      if(claimed){
        html += '<span style=color:#27ae60;font-size:14px>✅ 已提取 '+total.toLocaleString()+' NOVA</span>';
      } else if(unlocked){
        html += '<button onclick=doClaim('+i+') style="margin-top:8px;background:#27ae60;color:#fff;border:none;padding:12px 28px;border-radius:10px;font-size:16px;cursor:pointer;width:100%">📤 提取 '+total.toLocaleString()+' NOVA</button>';
      } else {
        const daysLeft = Math.ceil((s.unlockTime - now)/86400);
        html += '<span style=color:#f0ad4e;font-size:14px>🔒 还剩 '+daysLeft+' 天解锁</span>';
      }
      html += '</div>';
    }
    document.getElementById('myStakes').innerHTML = html;
  } catch(e){
    console.log('Stake load error:', e);
    document.getElementById('myStakes').innerHTML = '<p style=color:#889>加载失败，请确保在 BSC 网络上</p>';
  }
}

async function doClaim(idx){
  if(!window.ethereum) return;
  try {
    const accs = await ethereum.request({method:'eth_requestAccounts'});
    const user = accs[0];
    document.getElementById('claimMsg').textContent = '请在钱包中确认...';
    const hash = await ethereum.request({method:'eth_sendTransaction',params:[{
      from:user, to:STAKE, data: encClaim(idx), gas:'0x2DC6C0'
    }]});
    document.getElementById('claimMsg').innerHTML = '✅ 已提交！<br><small>TX: '+hash.substring(0,24)+'...</small>';
    setTimeout(loadStakeInfo, 8000);
  } catch(e){
    if(e.code===4001) document.getElementById('claimMsg').textContent = '❌ 取消了交易';
    else document.getElementById('claimMsg').textContent = '❌ '+(e.message||'').substring(0,80);
  }
}

async function doStake(){
  if(!window.ethereum) return alert('请用钱包内置浏览器打开');
  try {
    const amt = document.getElementById('stakeAmount').value;
    if(!amt||parseFloat(amt)<=0) return alert('请输入数量');
    const planDay = parseInt(document.getElementById('plan').value);
    const amtWei = BigInt(Math.floor(parseFloat(amt)*1e18));
    const accs = await ethereum.request({method:'eth_requestAccounts'});
    const user = accs[0];

    // 检查授权
    const allowHex = await rpcCall('eth_call',[{to:NOVA,data:encAllowance(user,STAKE)},'latest']);
    if(decUint256(allowHex,0) < amtWei){
      document.getElementById('stakeMsg').textContent = '🔓 请在钱包中确认授权...';
      await ethereum.request({method:'eth_sendTransaction',params:[{
        from:user, to:NOVA,
        data: encApprove(STAKE, '999000000000000000000000000'),
        gas:'0x186A0'
      }]});
      document.getElementById('stakeMsg').textContent = '✅ 已授权，正在质押...';
    }

    document.getElementById('stakeMsg').textContent = '🔒 请在钱包中确认质押...';
    const hash = await ethereum.request({method:'eth_sendTransaction',params:[{
      from:user, to:STAKE,
      data: encStake(amtWei.toString(), (planDay*86400).toString()),
      gas:'0x2DC6C0'
    }]});
    document.getElementById('stakeMsg').innerHTML = '✅ 质押成功！<br><small>'+hash.substring(0,24)+'...</small>';
    setTimeout(loadStakeInfo, 8000);
  } catch(e){
    if(e.code===4001) document.getElementById('stakeMsg').textContent = '❌ 取消了交易';
    else document.getElementById('stakeMsg').textContent = '❌ '+(e.message||'').substring(0,80);
  }
}

// 页面切换
function switchTab(tab){
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById(tab).classList.add('active');
  event.target.classList.add('active');
  if(tab==='stake') loadStakeInfo();
}

// Init — 每小时刷新仪表盘
loadPrice(); loadHolders();
setInterval(loadPrice, 3600000); // 每小时
setInterval(loadHolders, 3600000);
if(window.ethereum){
  ethereum.on('chainChanged', ()=>setTimeout(loadStakeInfo,1000));
  setTimeout(loadStakeInfo, 500);
}
