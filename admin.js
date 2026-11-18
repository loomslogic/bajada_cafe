(function(){
'use strict';
window.__adminLoaded=true;
document.title='Staff · Bajada Cafe (v3)';
var $=function(s){return document.querySelector(s)};
var $$=function(s){return [].slice.call(document.querySelectorAll(s))};
var peso=function(n){return '₱'+Number(n).toLocaleString('en-PH')};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
function notice(t,c){$('#notice').innerHTML=t?'<div class="notice '+(c||'ok')+'">'+t+'</div>':''}
window.addEventListener('error',function(e){notice('Script error: '+esc(e.message||'unknown')+'. Please send a screenshot of this to your developer.','warn')});
var hasCfg=!!(window.SB&&window.SB.url&&window.SB.url.indexOf('YOUR-')<0&&window.SB.key&&window.SB.key.indexOf('YOUR-')<0);
if(!hasCfg){notice('Add your Supabase Project URL and key to <b>config.js</b> (and make sure config.js is uploaded next to admin.html).','warn');return}
if(!window.supabase){notice('The Supabase library did not load. Check your internet connection and reload.','warn');return}
var sb;
try{sb=window.supabase.createClient(window.SB.url,window.SB.key)}
catch(e){notice('Problem with the details in <b>config.js</b>: '+esc(e.message)+'. The Project URL must look like https://xxxx.supabase.co and the key must be the Publishable key.','warn');return}

var M=(typeof MENU!=='undefined'&&MENU)||[];
var st=null,ms={},ofilter='active',orders=[],timer=null;

/* ---------- login ---------- */
function show(session){
  clearInterval(timer);
  if(!session){$('#login').hidden=false;$('#panel').hidden=true;$('#signedIn').hidden=true;return}
  sb.rpc('am_i_staff').then(function(r){
    if(r.error||r.data!==true){
      notice('This account is not a staff account.','warn');
      sb.auth.signOut();return;
    }
    notice('');
    $('#login').hidden=true;$('#panel').hidden=false;$('#signedIn').hidden=false;
    loadOrders();loadStore();loadMenu();
    timer=setInterval(function(){if(!document.hidden&&$('#t-orders').hidden===false)loadOrders()},15000);
  });
}
sb.auth.getSession().then(function(r){show(r.data.session)});
sb.auth.onAuthStateChange(function(ev,s){if(ev==='SIGNED_OUT')show(null)});
$('#doLogin').onclick=function(){
  var b=this;b.disabled=true;$('#loginErr').textContent='';
  sb.auth.signInWithPassword({email:$('#aEmail').value.trim(),password:$('#aPass').value}).then(function(r){
    b.disabled=false;
    if(r.error){var m=r.error.message||'';$('#loginErr').textContent=/confirm/i.test(m)?'This email is not confirmed yet. In Supabase open Authentication → Users, delete this user and add it again with “Auto Confirm User” ticked.':(/invalid login/i.test(m)?'Wrong email or password, or this user does not exist yet in Supabase (Authentication → Users).':'Could not sign in: '+m);return}
    $('#aPass').value='';show(r.data.session);
  });
};
$('#aPass').addEventListener('keydown',function(e){if(e.key==='Enter')$('#doLogin').click()});
$('#signOut').onclick=function(){sb.auth.signOut().then(function(){show(null)})};

/* ---------- tabs ---------- */
$('#tabs').addEventListener('click',function(e){
  var b=e.target.closest('.chip');if(!b)return;
  $$('#tabs .chip').forEach(function(x){x.classList.toggle('on',x===b)});
  $$('.atab').forEach(function(t){t.hidden=t.id!=='t-'+b.dataset.t});
  if(b.dataset.t==='orders')loadOrders();
});

/* ---------- orders ---------- */
var LABEL={awaiting_payment:'Waiting for payment',awaiting_verification:'Verify payment',paid:'Paid',preparing:'Preparing',ready:'Ready',done:'Done',cancelled:'Cancelled'};
function loadOrders(){
  sb.from('orders').select('*').order('id',{ascending:false}).limit(100).then(function(r){
    if(r.error){$('#orders').innerHTML='<p class="hint">Could not load orders.</p>';return}
    orders=r.data||[];renderOrders();
  });
}
function renderOrders(){
  var list=orders.filter(function(o){return ofilter==='all'||(o.status!=='done'&&o.status!=='cancelled')});
  var pending=orders.filter(function(o){return o.status==='awaiting_verification'}).length;
  $('#badge').textContent=pending||'';
  if(!list.length){$('#orders').innerHTML='<p class="hint">No orders yet.</p>';return}
  $('#orders').innerHTML=list.map(function(o){
    var t=new Date(o.created_at).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    var items=(o.items||[]).map(function(i){return '<li>'+i.qty+' × '+esc(i.name)+(i.size?' ('+esc(i.size)+')':'')+' — '+peso(i.price*i.qty)+'</li>'}).join('');
    var btns=[];
    if(o.proof_path)btns.push('<button data-a="proof" data-p="'+esc(o.proof_path)+'">View screenshot</button>');
    if(o.status==='awaiting_verification'||o.status==='awaiting_payment')btns.push('<button class="main" data-a="s" data-id="'+o.id+'" data-s="paid">Mark paid</button>');
    if(o.status==='paid')btns.push('<button class="main" data-a="s" data-id="'+o.id+'" data-s="preparing">Start preparing</button>');
    if(o.status==='preparing')btns.push('<button class="main" data-a="s" data-id="'+o.id+'" data-s="ready">Mark ready</button>');
    if(o.status==='ready')btns.push('<button class="main" data-a="s" data-id="'+o.id+'" data-s="done">Mark done</button>');
    if(o.status!=='done'&&o.status!=='cancelled')btns.push('<button data-a="s" data-id="'+o.id+'" data-s="cancelled">Cancel</button>');
    return '<div class="card ocard"><div class="ohead"><b>#'+esc(o.ref)+' · '+esc(o.customer_name)+'</b><span class="pill">'+esc(LABEL[o.status]||o.status)+'</span></div>'+
      '<div class="hint">'+t+' · <a href="tel:'+esc(o.mobile)+'">'+esc(o.mobile)+'</a> · '+(o.order_type==='dine_in'?'Dine in ('+(o.seats||'?')+' seats)':'Pickup')+(o.arrival?' · '+esc(o.arrival):'')+'</div>'+
      '<ul>'+items+'</ul>'+(o.instructions?'<div class="hint">Note: '+esc(o.instructions)+'</div>':'')+
      '<div class="rtotal"><span>Total</span><span>'+peso(o.total)+'</span></div><div class="btnrow">'+btns.join('')+'</div></div>';
  }).join('');
}
$('#ofilter').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;ofilter=b.dataset.f;$$('#ofilter button').forEach(function(x){x.classList.toggle('on',x===b)});renderOrders()});
$('#orders').addEventListener('click',function(e){
  var b=e.target.closest('button');if(!b)return;
  if(b.dataset.a==='proof'){
    sb.storage.from('payment-proofs').createSignedUrl(b.dataset.p,120).then(function(r){if(r.data&&r.data.signedUrl)window.open(r.data.signedUrl,'_blank');else alert('Could not open the screenshot.')});
  }else if(b.dataset.a==='s'){
    if(b.dataset.s==='cancelled'&&!confirm('Cancel this order?'))return;
    b.disabled=true;
    sb.from('orders').update({status:b.dataset.s}).eq('id',+b.dataset.id).then(function(r){if(r.error)alert('Could not update the order.');loadOrders()});
  }
});

/* ---------- store settings ---------- */
function loadStore(){
  sb.from('settings').select('*').eq('id',1).maybeSingle().then(function(r){
    if(r.error||!r.data){$('#storeMsg').textContent='Could not load settings.';return}
    st=r.data;paintStore();$('#storeMsg').textContent='Loaded from server';
  });
}
function when(iso){return iso?'Back '+new Date(iso).toLocaleString('en-PH',{weekday:'short',hour:'numeric',minute:'2-digit'}):'No time set'}
function paintStore(){
  $$('#openSeg button').forEach(function(b){b.classList.toggle('on',(b.dataset.v==='1')===!!st.store_open)});
  $$('#dineSeg button').forEach(function(b){b.classList.toggle('on',(b.dataset.v==='1')===!!st.dine_in_available)});
  $('#sMsg').value=st.store_message||'';$('#dReason').value=st.dine_in_reason||'';
  $('#gNumIn').value=st.gcash_number||'';$('#gNameIn').value=st.gcash_name||'';
  $('#sWhen').textContent=when(st.store_reopen_at);$('#dWhen').textContent=when(st.dine_in_reopen_at);
}
$$('.quick').forEach(function(q){
  q.innerHTML=['+1 hr','+2 hrs','+4 hrs','Tomorrow 8am','Clear'].map(function(l){return '<button type="button">'+l+'</button>'}).join('');
  q.addEventListener('click',function(e){
    var b=e.target.closest('button');if(!b||!st)return;
    var d=new Date(),t=b.textContent,v=null;
    if(t==='+1 hr'){d.setHours(d.getHours()+1);v=d}
    else if(t==='+2 hrs'){d.setHours(d.getHours()+2);v=d}
    else if(t==='+4 hrs'){d.setHours(d.getHours()+4);v=d}
    else if(t==='Tomorrow 8am'){d.setDate(d.getDate()+1);d.setHours(8,0,0,0);v=d}
    var iso=v?v.toISOString():null;
    if(q.dataset.for==='store')st.store_reopen_at=iso;else st.dine_in_reopen_at=iso;
    paintStore();
  });
});
$('#openSeg').addEventListener('click',function(e){var b=e.target.closest('button');if(!b||!st)return;st.store_open=b.dataset.v==='1';paintStore()});
$('#dineSeg').addEventListener('click',function(e){var b=e.target.closest('button');if(!b||!st)return;st.dine_in_available=b.dataset.v==='1';paintStore()});
$('#saveStore').onclick=function(){
  if(!st)return;var b=this;b.disabled=true;
  var row={store_open:st.store_open,store_message:$('#sMsg').value.trim(),store_reopen_at:st.store_reopen_at||null,dine_in_available:st.dine_in_available,dine_in_reason:$('#dReason').value.trim(),dine_in_reopen_at:st.dine_in_reopen_at||null,gcash_number:$('#gNumIn').value.trim(),gcash_name:$('#gNameIn').value.trim()};
  sb.from('settings').update(row).eq('id',1).select().then(function(r){
    b.disabled=false;
    if(r.error||!r.data||!r.data.length){$('#storeMsg').textContent='Could not save. Check that you are signed in as staff.';return}
    st=r.data[0];paintStore();$('#storeMsg').textContent='Saved ✓';
  });
};
$('#discardStore').onclick=loadStore;

/* ---------- menu items ---------- */
function mkey(c,n){return c+'|'+n}
function loadMenu(){
  sb.from('menu_items').select('key,status').then(function(r){
    ms={};(r.data||[]).forEach(function(x){ms[x.key]=x.status});
    var sel=$('#mCat');
    if(!sel.options.length){sel.innerHTML='<option value="all">All categories</option>'+M.map(function(m,k){return '<option value="'+k+'">'+esc(m.c)+'</option>'}).join('')}
    paintMenu();$('#menuMsg').textContent=r.error?'Could not load saved statuses.':'Loaded from server';
  });
}
function paintMenu(){
  var c=$('#mCat').value;
  $('#mList').innerHTML=M.map(function(m,k){
    if(c!=='all'&&String(k)!==c)return '';
    return '<h3 class="hint" style="margin:14px 0 6px;text-transform:uppercase">'+esc(m.c)+'</h3>'+m.i.map(function(i){
      var key=mkey(m.c,i.n),s=ms[key]||'on',pr=i.p.length>1?peso(i.p[0])+' / '+peso(i.p[1]):peso(i.p[0]);
      return '<div class="card arow"><div><b>'+esc(i.n)+'</b><div class="hint">'+pr+'</div></div><div class="seg" data-key="'+esc(key)+'">'+
        ['on:On','soldout:Sold out','removed:Remove'].map(function(o){var p=o.split(':');return '<button data-v="'+p[0]+'" class="'+(s===p[0]?'on':'')+'">'+p[1]+'</button>'}).join('')+'</div></div>';
    }).join('');
  }).join('');
}
$('#mCat').onchange=paintMenu;
$('#mList').addEventListener('click',function(e){
  var b=e.target.closest('button'),seg=e.target.closest('.seg');if(!b||!seg)return;
  ms[seg.dataset.key]=b.dataset.v;
  [].forEach.call(seg.children,function(x){x.classList.toggle('on',x===b)});
});
$('#saveMenu').onclick=function(){
  var b=this;b.disabled=true;
  var rows=[];
  M.forEach(function(m){m.i.forEach(function(i){
    rows.push({key:mkey(m.c,i.n),category:m.c,name:i.n,prices:i.p,labels:i.p.length>1?(i.z||['16oz','22oz']):[],status:ms[mkey(m.c,i.n)]||'on',updated_at:new Date().toISOString()});
  })});
  sb.from('menu_items').upsert(rows,{onConflict:'key'}).then(function(r){
    b.disabled=false;
    $('#menuMsg').textContent=r.error?'Could not save. Check that you are signed in as staff.':'Saved ✓ (prices synced from menu.js)';
  });
};
$('#discardMenu').onclick=loadMenu;

/* ---------- password ---------- */
$('#updPass').onclick=function(){
  var a=$('#pNew').value,c=$('#pNew2').value,err=$('#pErr');err.textContent='';
  if(a.length<8){err.textContent='Use at least 8 characters.';return}
  if(a!==c){err.textContent='The two passwords don’t match.';return}
  sb.auth.updateUser({password:a}).then(function(r){
    if(r.error){err.textContent='Could not update the password. Please sign in again and retry.';return}
    $('#pNew').value='';$('#pNew2').value='';err.style.color='var(--accent)';err.textContent='Password updated ✓';
  });
};
})();
