(function(){
'use strict';
window.__orderLoaded=true;
var $=function(s){return document.querySelector(s)};
var $$=function(s){return [].slice.call(document.querySelectorAll(s))};
var peso=function(n){return '₱'+Number(n).toLocaleString('en-PH')};
var esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
var STORE_KEY='bajada_order';

function cleanUrl(u){u=String(u||'').trim();try{return new URL(u).origin}catch(e){return u.replace(/\/+$/,'')}}
var sb=null,cfgOk=!!(window.SB&&window.SB.url&&window.SB.url.indexOf('YOUR-')<0&&window.SB.key&&window.supabase);
if(cfgOk){try{sb=window.supabase.createClient(cleanUrl(window.SB.url),String(window.SB.key).trim())}catch(e){cfgOk=false;sb=null;setTimeout(function(){notice('Ordering setup problem: '+esc(e.message)+'. Check config.js.','warn')},0)}}

var M=(typeof MENU!=='undefined'&&MENU)||[];
if(window.ORDER_ONLY_PHOTOS!==false){M=M.map(function(m){return {c:m.c,i:m.i.filter(function(i){return i.img})}}).filter(function(m){return m.i.length})}
var byKey={};M.forEach(function(m){m.i.forEach(function(i){byKey[m.c+'|'+i.n]={c:m.c,i:i,labels:i.p.length>1?(i.z||['16oz','22oz']):['']}})});

var status={},settings=null,canOrder=cfgOk,cart={},step=1,info=null,orderType='pickup',proofBlob=null,pollT=null;

function notice(html,cls){$('#notice').innerHTML=html?'<div class="notice '+(cls||'ok')+'">'+html+'</div>':''}
function fmtWhen(iso){try{return new Date(iso).toLocaleString('en-PH',{weekday:'short',hour:'numeric',minute:'2-digit'})}catch(e){return ''}}
function isOpen(){if(!settings)return true;return !!(settings.store_open||(settings.store_reopen_at&&new Date()>=new Date(settings.store_reopen_at)))}
function dineOpen(){if(!settings)return true;return !!(settings.dine_in_available||(settings.dine_in_reopen_at&&new Date()>=new Date(settings.dine_in_reopen_at)))}

/* ---------- steps ---------- */
function go(n){
  step=n;
  $$('.ostep').forEach(function(e){e.hidden=e.id!=='step'+n});
  $$('#steps li').forEach(function(li){var s=+li.dataset.s;li.classList.toggle('on',s===n);li.classList.toggle('past',s<n)});
  $('#cartbar').hidden=!(n===1&&count()>0);
  window.scrollTo(0,0);
}
function count(){var c=0;Object.keys(cart).forEach(function(k){c+=cart[k].q});return c}
function total(){var t=0;Object.keys(cart).forEach(function(id){var l=cart[id],it=byKey[l.k];if(it)t+=it.i.p[l.s]*l.q});return t}
function updateBar(){
  var c=count();
  $('#cbCount').textContent=c+(c===1?' item':' items');
  $('#cbTotal').textContent=peso(total());
  $('#cartbar').hidden=!(step===1&&c>0);
}
function setQty(id,d){
  if(!canOrder)return;
  var p=id.split('#'),k=p[0],s=+p[1],it=byKey[k];
  if(!it||status[k]==='soldout'||status[k]==='removed')return;
  var q=((cart[id]&&cart[id].q)||0)+d;
  if(q>20)q=20;
  if(q<=0)delete cart[id];else cart[id]={k:k,s:s,q:q};
  $$('[data-qty="'+id.replace(/"/g,'')+'"]').forEach(function(e){e.textContent=(cart[id]&&cart[id].q)||0});
  updateBar();
  if(step===2)renderReview();
}

/* ---------- menu ---------- */
function renderMenu(){
  var chips='<button class="chip on" data-c="all">All</button>'+M.map(function(m,k){return '<button class="chip" data-c="'+k+'">'+esc(m.c)+'</button>'}).join('');
  $('#chips').innerHTML=chips;
  if(M.length<2)$('#chips').style.display='none';
  $('#menuRoot').innerHTML=M.map(function(m,k){
    var cards=m.i.map(function(i){
      var key=m.c+'|'+i.n,st=status[key];
      if(st==='removed')return '';
      var rows=i.p.map(function(p,s){
        var lab=i.p.length>1?'<em>'+esc((i.z||['16oz','22oz'])[s])+'</em> ':'';
        var id=key+'#'+s;
        var ctl=(st==='soldout')?'<span class="soldtag">Sold out</span>':(canOrder?'<div class="qty"><button type="button" data-act="d" data-id="'+esc(id)+'" data-d="-1" aria-label="Remove one">−</button><b data-qty="'+esc(id)+'">'+((cart[id]&&cart[id].q)||0)+'</b><button type="button" data-act="d" data-id="'+esc(id)+'" data-d="1" aria-label="Add one">+</button></div>':'');
        return '<div class="qrow"><span class="qp">'+lab+peso(p)+'</span>'+ctl+'</div>';
      }).join('');
      return '<div class="card pcard'+(st==='soldout'?' soldout':'')+'">'+(i.img?'<img class="pimg" src="'+esc(i.img)+'" alt="'+esc(i.n)+'" loading="lazy">':'')+'<span class="pname">'+esc(i.n)+'</span>'+(i.d?'<span class="pdesc">'+esc(i.d)+'</span>':'')+rows+'</div>';
    }).join('');
    return '<div class="group" data-c="'+k+'"><h3>'+esc(m.c)+'</h3><div class="grid">'+cards+'</div></div>';
  }).join('');
}
$('#chips').addEventListener('click',function(e){
  var b=e.target.closest('.chip');if(!b)return;
  $$('#chips .chip').forEach(function(x){x.classList.toggle('on',x===b)});
  $$('#menuRoot .group').forEach(function(g){g.style.display=(b.dataset.c==='all'||g.dataset.c===b.dataset.c)?'':'none'});
});
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-act="d"]');if(!b)return;
  setQty(b.dataset.id,+b.dataset.d);
});

/* ---------- review ---------- */
function renderReview(){
  var ids=Object.keys(cart);
  if(!ids.length){$('#reviewList').innerHTML='<p class="hint">Your order is empty.</p>';$('#toDetails').disabled=true;return}
  $('#toDetails').disabled=false;
  $('#reviewList').innerHTML=ids.map(function(id){
    var l=cart[id],it=byKey[l.k],lab=it.labels[l.s];
    return '<div class="rline"><div class="qrow"><b>'+esc(it.i.n)+(lab?' <span class="hint">'+esc(lab)+'</span>':'')+'</b><span class="qp">'+peso(it.i.p[l.s]*l.q)+'</span></div><div class="qrow"><span class="hint">'+peso(it.i.p[l.s])+' each</span><div class="qty"><button type="button" data-act="d" data-id="'+esc(id)+'" data-d="-1">−</button><b>'+l.q+'</b><button type="button" data-act="d" data-id="'+esc(id)+'" data-d="1">+</button></div></div></div>';
  }).join('')+'<div class="rtotal"><span>Total</span><span>'+peso(total())+'</span></div>';
}
$('#cbGo').onclick=function(){renderReview();go(2)};
$('#backMenu').onclick=function(){go(1)};
$('#toDetails').onclick=function(){if(!canOrder||!count())return;prepDetails();go(3)};
$('#backReview').onclick=function(){renderReview();go(2)};

/* ---------- details ---------- */
function prepDetails(){
  var ok=dineOpen();
  $('[data-t="dine_in"]').disabled=!ok;
  $('#dineNote').textContent=ok?'':('Dine in isn’t available right now'+(settings&&settings.dine_in_reason?': '+settings.dine_in_reason:'')+(settings&&settings.dine_in_reopen_at?'. Back '+fmtWhen(settings.dine_in_reopen_at):'')+'. Pickup is still open.');
  if(!ok&&orderType==='dine_in')setType('pickup');
}
function setType(t){
  orderType=t;
  $$('#typeSeg button').forEach(function(b){b.classList.toggle('on',b.dataset.t===t)});
  $('#seatsWrap').hidden=t!=='dine_in';
}
$('#typeSeg').addEventListener('click',function(e){var b=e.target.closest('button');if(b&&!b.disabled)setType(b.dataset.t)});

var ERR={STORE_CLOSED:'Sorry, the store just closed. Please try again later.',DINE_IN_UNAVAILABLE:'Dine in just became unavailable. Please choose Pickup.',ITEM_UNAVAILABLE:'An item in your order is no longer available. Please go back and review your order.',BAD_NAME:'Please enter your full name.',BAD_MOBILE:'Please enter a valid mobile number (09XXXXXXXXX).',BAD_QTY:'Please check the quantities in your order.',BAD_ITEMS:'Your order is empty.',BAD_SIZE:'Please review your order.'};
function errText(e){var m=(e&&e.message)||'';for(var k in ERR){if(m.indexOf(k)>-1)return ERR[k]}return 'Something went wrong. Please check your connection and try again.'}

$('#detailsForm').addEventListener('submit',function(e){
  e.preventDefault();
  var name=$('#fName').value.trim(),mobile=$('#fMobile').value.replace(/\s|-/g,''),err=$('#formErr');
  err.textContent='';
  if(name.length<2){err.textContent='Please enter your full name.';return}
  if(!/^09\d{9}$/.test(mobile)){err.textContent='Please enter a valid mobile number (09XXXXXXXXX).';return}
  var seats=parseInt($('#fSeats').value,10);
  if(orderType==='dine_in'&&!(seats>=1&&seats<=20)){err.textContent='Please enter how many seats you need (1–20).';return}
  if(!$('#fConsent').checked){err.textContent='Please tick the box to continue.';return}
  var btn=$('#toPay');btn.disabled=true;btn.textContent='Please wait…';
  var items=Object.keys(cart).map(function(id){var l=cart[id];return {k:l.k,s:l.s,q:l.q}});
  sb.rpc('place_order',{p_name:name,p_mobile:mobile,p_instructions:$('#fNote').value.trim(),p_type:orderType,p_seats:orderType==='dine_in'?seats:null,p_arrival:$('#fArrive').value,p_items:items}).then(function(r){
    btn.disabled=false;btn.textContent='Proceed to payment →';
    if(r.error||!r.data||!r.data.length){err.textContent=errText(r.error);return}
    var row=r.data[0];
    info={ref:row.order_ref,total:Number(row.order_total),mobile:mobile};
    try{localStorage.setItem(STORE_KEY,JSON.stringify(info))}catch(x){}
    cart={};updateBar();
    showPayment();
  });
});

/* ---------- payment ---------- */
function showPayment(){
  $('#gNum').textContent=(settings&&settings.gcash_number)||'';
  $('#gName').textContent=(settings&&settings.gcash_name)||'';
  $('#gAmt').textContent=peso(info.total);
  $('#refNo').textContent=info.ref;
  $('#payErr').textContent='';$('#proof').value='';proofBlob=null;$('#proofPrev').hidden=true;$('#paid').disabled=true;
  go(4);
}
function compress(file,cb){
  var img=new Image(),url=URL.createObjectURL(file);
  img.onload=function(){
    var max=1400,sc=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement('canvas');
    c.width=Math.round(img.width*sc);c.height=Math.round(img.height*sc);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    c.toBlob(function(b){URL.revokeObjectURL(url);cb(b)},'image/jpeg',0.8);
  };
  img.onerror=function(){URL.revokeObjectURL(url);cb(null)};
  img.src=url;
}
$('#proof').addEventListener('change',function(){
  var f=this.files&&this.files[0];proofBlob=null;$('#paid').disabled=true;$('#proofPrev').hidden=true;
  if(!f)return;
  if(!/^image\//.test(f.type)||f.size>25*1024*1024){$('#payErr').textContent='Please choose an image (screenshot) under 25 MB.';return}
  $('#payErr').textContent='';
  compress(f,function(b){
    if(!b){$('#payErr').textContent='That image could not be read. Please try another one.';return}
    proofBlob=b;$('#proofPrev').src=URL.createObjectURL(b);$('#proofPrev').hidden=false;$('#paid').disabled=false;
  });
});
function uid(){return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2)}
$('#paid').onclick=function(){
  if(!proofBlob||!info)return;
  var btn=this;btn.disabled=true;btn.textContent='Sending…';$('#payErr').textContent='';
  var path=info.ref+'/'+uid()+'.jpg';
  sb.storage.from('payment-proofs').upload(path,proofBlob,{contentType:'image/jpeg',upsert:false}).then(function(u){
    if(u.error)throw u.error;
    return sb.rpc('attach_proof',{p_ref:info.ref,p_mobile:info.mobile,p_path:path});
  }).then(function(r){
    if(r.error||r.data!==true)throw (r.error||new Error('attach'));
    btn.textContent='✓ I’ve sent the payment';
    showDone();
  }).catch(function(){
    btn.disabled=false;btn.textContent='✓ I’ve sent the payment';
    $('#payErr').textContent='We couldn’t send your screenshot. Please check your connection and try again.';
  });
};

/* ---------- done ---------- */
var LABEL={awaiting_payment:'Waiting for payment',awaiting_verification:'Payment under review',paid:'Payment confirmed',preparing:'Being prepared',ready:'Ready!',done:'Completed',cancelled:'Cancelled'};
var MSG={awaiting_payment:'Please complete your GCash payment and attach your screenshot.',awaiting_verification:'Thanks! We’re checking your payment. Keep this reference number.',paid:'Your payment is confirmed. We’ll start on your order shortly.',preparing:'Your order is being prepared.',ready:'Your order is ready. We’ll call your name!',done:'Thank you for ordering from Bajada Cafe!',cancelled:'This order was cancelled. Please contact the shop if you have questions.'};
function showDone(){
  $('#doneRef').textContent=info.ref;
  setStatus('awaiting_verification');
  go(5);
  clearInterval(pollT);pollT=setInterval(poll,12000);
}
function setStatus(s){$('#doneStatus').textContent=LABEL[s]||s;$('#doneMsg').textContent=MSG[s]||''}
function poll(){
  if(!info||step!==5)return;
  sb.rpc('order_status',{p_ref:info.ref,p_mobile:info.mobile}).then(function(r){if(!r.error&&r.data)setStatus(r.data)});
}
$('#newOrder').onclick=function(){clearInterval(pollT);try{localStorage.removeItem(STORE_KEY)}catch(e){};info=null;cart={};renderMenu();updateBar();go(1)};

/* ---------- start ---------- */
function resume(){
  var saved=null;try{saved=JSON.parse(localStorage.getItem(STORE_KEY)||'null')}catch(e){}
  if(!saved||!saved.ref||!sb)return;
  sb.rpc('order_status',{p_ref:saved.ref,p_mobile:saved.mobile}).then(function(r){
    if(r.error)return;
    if(!r.data){try{localStorage.removeItem(STORE_KEY)}catch(e){}return}
    info=saved;
    if(r.data==='awaiting_payment'){showPayment()}
    else{$('#doneRef').textContent=info.ref;setStatus(r.data);go(5);clearInterval(pollT);pollT=setInterval(poll,12000)}
  });
}
function start(){
  renderMenu();updateBar();go(1);
  if(!cfgOk){canOrder=false;notice('Online ordering isn’t switched on yet. You can browse the menu below.','warn');renderMenu();return}
  Promise.all([sb.from('settings').select('*').eq('id',1).maybeSingle(),sb.from('menu_items').select('key,status')]).then(function(res){
    if(res[0].error||res[1].error)throw new Error('load');
    settings=res[0].data;(res[1].data||[]).forEach(function(r){status[r.key]=r.status});
    if(!isOpen()){
      canOrder=false;
      notice('<b>We’re closed for online orders right now.</b>'+(settings.store_message?'<br>'+esc(settings.store_message):'')+(settings.store_reopen_at?'<br>Back '+esc(fmtWhen(settings.store_reopen_at))+'.':''),'warn');
    }
    renderMenu();resume();
  }).catch(function(){canOrder=false;notice('We can’t reach the ordering service right now. Please try again in a moment.','warn');renderMenu()});
}
start();
})();
