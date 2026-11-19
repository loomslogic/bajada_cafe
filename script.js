(function(){
  var BC=window.BC,root=document.getElementById('menuRoot'),chips=document.getElementById('chips'),bar=document.getElementById('cartbar'),note=document.getElementById('menuNotice');
  function updateBar(){
    var t=BC.totals();
    document.getElementById('cbCount').textContent=t.count+(t.count===1?' item':' items');
    document.getElementById('cbTotal').textContent=BC.peso(t.total);
    bar.hidden=!(BC.state.canOrder&&t.count>0);
  }
  BC.onCart=updateBar;
  function paint(res){
    var canOrder=!!(res.online&&BC.isOpen(res.settings));
    BC.setMenu(res.menu,canOrder);
    if(res.online&&!BC.isOpen(res.settings)){
      var s=res.settings;
      note.innerHTML='<div class="notice warn"><b>We’re closed for online orders right now.</b>'+(s.store_message?'<br>'+BC.esc(s.store_message):'')+(s.store_reopen_at?'<br>Back '+BC.esc(BC.fmtWhen(s.store_reopen_at))+'.':'')+'</div>';
    }
    if(!res.menu.length){root.innerHTML='<p class="empty">Our menu is coming soon.</p>';chips.style.display='none';return}
    root.innerHTML=BC.groups(res.menu);
    BC.chips(res.menu,chips,root);
    updateBar();BC.observe();
  }
  BC.observe();
  BC.load().then(paint);
})();
