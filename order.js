(function(){
'use strict';
window.__orderLoaded=true;
if(!window.BC){var __n=document.getElementById('notice');if(__n)__n.innerHTML='<div class="notice warn">shop.js did not load. Upload shop.js to the same folder as this page, then reload.</div>';return}

var BC=window.BC,$=function(s){return document.querySelector(s)},$$=function(s){return [].slice.call(document.querySelectorAll(s))};
var peso=BC.peso,esc=BC.esc,sb=BC.sb;
var STORE_KEY='bajada_order';
var settings=null,online=false,canOrder=false,step=1,info=null,orderType='pickup',payMethod='gcash',proofBlob=null,pollT=null;

function notice(html,cls){$('#notice').innerHTML=html?'<div class="notice '+(cls||'ok')+'">'+html+'</div>':''}
window.addEventListener('error',function(e){notice('Script error: '+esc(e.message||'unknown'),'warn')});

/* ---------- steps ---------- */
function go(n){
  step=n;
  $$('.ostep').forEach(function(e){e.hidden=e.id!=='step'+n});
  $$('#steps li').forEach(function(li){var s=+li.dataset.s;li.classList.toggle('on',s===n);li.classList.toggle('past',s<n)});
  updateBar();window.scrollTo(0,0);
}
function updateBar(){
  var t=BC.totals();
  $('#cbCount').textContent=t.count+(t.count===1?' item':' items');
  $('#cbTotal').textContent=peso(t.total);
  $('#cartbar').hidden=!(step===1&&t.count>0&&canOrder);
}
BC.onCart=function(){updateBar();if(step===2)renderReview()};

/* ---------- menu ---------- */
function renderMenu(menu){
  var root=$('#menuRoot');
  if(!menu.length){root.innerHTML='<p class="empty">Our menu is coming soon.</p>';$('#chips').style.display='none';return}
  root.innerHTML=BC.groups(menu);BC.chips(menu,$('#chips'),root);BC.observe();
}

/* ---------- review ---------- */
function renderReview(){
  var S=BC.state,ids=Object.keys(S.cart).filter(function(id){return S.idx[S.cart[id].k]});
  if(!ids.length){$('#reviewList').innerHTML='<p class="hint">Your order is empty.</p>';$('#toDetails').disabled=true;return}
  $('#toDetails').disabled=false;
  $('#reviewList').innerHTML=ids.map(function(id){
    var l=S.cart[id],it=S.idx[l.k],lab=it.p.length>1?((it.z&&it.z[l.s])||''):'';
    return '<div class="rline"><div class="qrow"><b>'+esc(it.n)+(lab?' <span class="hint">'+esc(lab)+'</span>':'')+'</b><span class="qp">'+peso(it.p[l.s]*l.q)+'</span></div><div class="qrow"><span class="hint">'+peso(it.p[l.s])+' each</span><div class="qty"><button type="button" data-act="d" data-id="'+esc(id)+'" data-d="-1">−</button><b>'+l.q+'</b><button type="button" data-act="d" data-id="'+esc(id)+'" data-d="1">+</button></div></div></div>';
  }).join('')+'<div class="rtotal"><span>Total</span><span>'+peso(BC.totals().total)+'</span></div>';
}
$('#cbGo').onclick=function(){renderReview();go(2)};
$('#backMenu').onclick=function(){go(1)};
$('#toDetails').onclick=function(){if(!canOrder||!BC.totals().count)return;prepDetails();go(3)};
$('#backReview').onclick=function(){renderReview();go(2)};

/* ---------- details + payment method ---------- */
function methods(){
  var s=settings||{},m=[];
  if(s.pay_gcash!==false)m.push({id:'gcash',l:'GCash'});
  if(s.pay_maya)m.push({id:'maya',l:'Maya'});
  if(s.pay_cash!==false)m.push({id:'cash',l:'Pay at the counter'});
  return m.length?m:[{id:'gcash',l:'GCash'}];
}
function paintMethods(){
  var m=methods();
  if(!m.some(function(x){return x.id===payMethod}))payMethod=m[0].id;
  $('#paym').innerHTML=m.map(function(x){return '<button type="button" data-m="'+x.id+'" class="'+(x.id===payMethod?'on':'')+'">'+esc(x.l)+'</button>'}).join('');
  $('#payNote').textContent=payMethod==='cash'?'You’ll pay at the counter when you pick up or dine in. No screenshot needed.':'You’ll get the payment details and a reference number on the next screen.';
}
$('#paym').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;payMethod=b.dataset.m;paintMethods()});
function prepDetails(){
  var ok=BC.dineOpen(settings);
  $('[data-t="dine_in"]').disabled=!ok;
  $('#dineNote').textContent=ok?'':('Dine in isn’t available right now'+(settings&&settings.dine_in_reason?': '+settings.dine_in_reason:'')+(settings&&settings.dine_in_reopen_at?'. Back '+BC.fmtWhen(settings.dine_in_reopen_at):'')+'. Pickup is still open.');
  if(!ok&&orderType==='dine_in')setType('pickup');
  paintMethods();
}
function setType(t){orderType=t;$$('#typeSeg button').forEach(function(b){b.classList.toggle('on',b.dataset.t===t)});$('#seatsWrap').hidden=t!=='dine_in'}
$('#typeSeg').addEventListener('click',function(e){var b=e.target.closest('button');if(b&&!b.disabled)setType(b.dataset.t)});

var ERR={STORE_CLOSED:'Sorry, the store just closed. Please try again later.',DINE_IN_UNAVAILABLE:'Dine in just became unavailable. Please choose Pickup.',ITEM_UNAVAILABLE:'An item in your order is no longer available. Please go back and review your order.',BAD_NAME:'Please enter your full name.',BAD_MOBILE:'Please enter a valid mobile number (09XXXXXXXXX).',BAD_QTY:'Please check the quantities in your order.',BAD_ITEMS:'Your order is empty.',BAD_SIZE:'Please review your order.',BAD_METHOD:'That payment method isn’t available right now. Please choose another.'};
function errText(e){var m=(e&&e.message)||'';for(var k in ERR){if(m.indexOf(k)>-1)return ERR[k]}if(/place_order/.test(m)&&/function|schema cache/i.test(m))return 'The ordering system needs its database update (supabase-update-v2.sql). Please tell the shop.';return 'Something went wrong. Please check your connection and try again.'}

$('#detailsForm').addEventListener('submit',function(e){
  e.preventDefault();
  var name=$('#fName').value.trim(),mobile=$('#fMobile').value.replace(/\s|-/g,''),err=$('#formErr');err.textContent='';
  if(name.length<2){err.textContent='Please enter your full name.';return}
  if(!/^09\d{9}$/.test(mobile)){err.textContent='Please enter a valid mobile number (09XXXXXXXXX).';return}
  var seats=parseInt($('#fSeats').value,10);
  if(orderType==='dine_in'&&!(seats>=1&&seats<=20)){err.textContent='Please enter how many seats you need (1–20).';return}
  if(!$('#fConsent').checked){err.textContent='Please tick the box to continue.';return}
  var btn=$('#toPay');btn.disabled=true;btn.textContent='Please wait…';
  var S=BC.state,items=Object.keys(S.cart).map(function(id){var l=S.cart[id];return {k:l.k,s:l.s,q:l.q}});
  sb.rpc('place_order',{p_name:name,p_mobile:mobile,p_instructions:$('#fNote').value.trim(),p_type:orderType,p_seats:orderType==='dine_in'?seats:null,p_arrival:$('#fArrive').value,p_items:items,p_method:payMethod}).then(function(r){
    btn.disabled=false;btn.textContent='Continue →';
    if(r.error||!r.data||!r.data.length){err.textContent=errText(r.error);return}
    var row=r.data[0];
    info={ref:row.order_ref,total:Number(row.order_total),mobile:mobile,method:payMethod};
    try{localStorage.setItem(STORE_KEY,JSON.stringify(info))}catch(x){}
    S.cart={};BC.setCart({});updateBar();
    if(payMethod==='cash'){showDone('pay_at_counter')}else{showPayment()}
  });
});

/* ---------- payment (GCash / Maya) ---------- */
function showPayment(){
  var s=settings||{},m=info.method||'gcash',label=m==='maya'?'Maya':'GCash';
  $('#payTitle').textContent='Pay via '+label;$('#proofLbl').textContent=label;
  $('#payHow').textContent='Open '+label+' → Send Money → enter the number above → exact amount → type your reference number in the note → Send.';
  $('#gNum').textContent=(m==='maya'?s.maya_number:s.gcash_number)||'';
  $('#gName').textContent=(m==='maya'?s.maya_name:s.gcash_name)||'';
  var qr=(m==='maya'?s.maya_qr:s.gcash_qr)||'';$('#payQr').hidden=!qr;if(qr)$('#payQr').src=qr;
  $('#gAmt').textContent=peso(info.total);$('#refNo').textContent=info.ref;
  $('#payErr').textContent='';$('#proof').value='';proofBlob=null;$('#proofPrev').hidden=true;$('#paid').disabled=true;
  go(4);
}
$('#proof').addEventListener('change',function(){
  var f=this.files&&this.files[0];proofBlob=null;$('#paid').disabled=true;$('#proofPrev').hidden=true;
  if(!f)return;
  if(!/^image\//.test(f.type)||f.size>25*1024*1024){$('#payErr').textContent='Please choose an image (screenshot) under 25 MB.';return}
  $('#payErr').textContent='';
  BC.compress(f,1400,function(b){
    if(!b){$('#payErr').textContent='That image could not be read. Please try another one.';return}
    proofBlob=b;$('#proofPrev').src=URL.createObjectURL(b);$('#proofPrev').hidden=false;$('#paid').disabled=false;
  });
});
$('#paid').onclick=function(){
  if(!proofBlob||!info)return;
  var btn=this;btn.disabled=true;btn.textContent='Sending…';$('#payErr').textContent='';
  var path=info.ref+'/'+BC.uid()+'.jpg';
  sb.storage.from('payment-proofs').upload(path,proofBlob,{contentType:'image/jpeg',upsert:false}).then(function(u){
    if(u.error)throw u.error;
    return sb.rpc('attach_proof',{p_ref:info.ref,p_mobile:info.mobile,p_path:path});
  }).then(function(r){
    if(r.error||r.data!==true)throw (r.error||new Error('attach'));
    btn.textContent='✓ I’ve sent the payment';showDone('awaiting_verification');
  }).catch(function(){
    btn.disabled=false;btn.textContent='✓ I’ve sent the payment';
    $('#payErr').textContent='We couldn’t send your screenshot. Please check your connection and try again.';
  });
};

/* ---------- done ---------- */
var LABEL={awaiting_payment:'Waiting for payment',awaiting_verification:'Payment under review',pay_at_counter:'Pay at the counter',paid:'Payment confirmed',preparing:'Being prepared',ready:'Ready!',done:'Completed',cancelled:'Cancelled'};
var MSG={awaiting_payment:'Please complete your payment and attach your screenshot.',awaiting_verification:'Thanks! We’re checking your payment. Keep this reference number.',pay_at_counter:'Please pay at the counter when you pick up. Keep this reference number.',paid:'Your payment is confirmed. We’ll start on your order shortly.',preparing:'Your order is being prepared.',ready:'Your order is ready. We’ll call your name!',done:'Thank you for ordering from Bajada Cafe!',cancelled:'This order was cancelled. Please contact the shop if you have questions.'};
function showDone(s){$('#doneRef').textContent=info.ref;setStatus(s);go(5);clearInterval(pollT);pollT=setInterval(poll,12000)}
function setStatus(s){$('#doneStatus').textContent=LABEL[s]||s;$('#doneMsg').textContent=MSG[s]||''}
function poll(){if(!info||step!==5)return;sb.rpc('order_status',{p_ref:info.ref,p_mobile:info.mobile}).then(function(r){if(!r.error&&r.data)setStatus(r.data)})}
$('#newOrder').onclick=function(){clearInterval(pollT);try{localStorage.removeItem(STORE_KEY)}catch(e){};info=null;go(1)};

/* ---------- start ---------- */
function resume(){
  var saved=null;try{saved=JSON.parse(localStorage.getItem(STORE_KEY)||'null')}catch(e){}
  if(!saved||!saved.ref||!sb)return Promise.resolve(false);
  return sb.rpc('order_status',{p_ref:saved.ref,p_mobile:saved.mobile}).then(function(r){
    if(r.error)return false;
    if(!r.data){try{localStorage.removeItem(STORE_KEY)}catch(e){}return false}
    info=saved;
    if(r.data==='awaiting_payment'&&info.method!=='cash'){showPayment()}else{showDone(r.data)}
    return true;
  });
}
function start(){
  go(1);
  if(!BC.hasCfg||!BC.libOk||!sb){
    BC.setMenu(BC.state.menu,false);
    notice('Online ordering isn’t switched on yet. You can browse the menu below.','warn');
    BC.load().then(function(res){renderMenu(res.menu)});return;
  }
  BC.load().then(function(res){
    settings=res.settings;online=res.online;
    if(!online){
      canOrder=false;BC.setMenu(res.menu,false);
      notice(res.failed?'We can’t reach the ordering service right now. Please try again in a moment.':'Online ordering isn’t switched on yet. You can browse the menu below.','warn');
      renderMenu(res.menu);return;
    }
    canOrder=BC.isOpen(settings);
    BC.setMenu(res.menu,canOrder);
    if(!canOrder){notice('<b>We’re closed for online orders right now.</b>'+(settings.store_message?'<br>'+esc(settings.store_message):'')+(settings.store_reopen_at?'<br>Back '+esc(BC.fmtWhen(settings.store_reopen_at))+'.':''),'warn')}
    renderMenu(res.menu);
    resume().then(function(resumed){
      if(!resumed&&canOrder&&/step=review/.test(location.search)&&BC.totals().count){renderReview();go(2)}
      else if(!resumed)updateBar();
    });
  });
}
start();
})();
