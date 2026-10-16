/* Collection: simplified STL models rendered as lazy thumbnails (one shared WebGL context) + an interactive dialog viewer */
(function(){
  var DATA = window.COLLECTION || [];
  var root = document.getElementById('coll');
  if (!root || !DATA.length) return;

  var lang = 'lv';
  var filter = 'all';
  var cards = [];
  var geoCache = {};
  var gl = null;           // shared offscreen renderer for thumbnails
  var viewer = null;       // dialog viewer state

  function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function isDark(){
    var m = cssVar('--paper').match(/#([0-9a-fA-F]{6})/);
    if (!m) return false;
    var n = parseInt(m[1], 16);
    return (0.2126*((n>>16)&255) + 0.7152*((n>>8)&255) + 0.0722*(n&255))/255 < 0.5;
  }
  function tr(k){ try { return T[k]; } catch (e) { return null; } }
  function fmt(x){
    var s = (Math.round(x*10)/10).toString();
    return lang === 'en' ? s : s.replace('.', ',');
  }
  function dimsText(d){ return fmt(d[0]) + ' × ' + fmt(d[1]) + ' × ' + fmt(d[2]) + (lang === 'ru' ? ' мм' : ' mm'); }
  function catText(c){
    var e = tr('cat.' + c);
    return e ? (e[lang] || e.lv) : c;
  }

  /* ---- geometry ---- */
  function geometryFor(m){
    if (geoCache[m.id]) return geoCache[m.id];
    var bin = atob(m.b), buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    var quant = new Uint16Array(buf.buffer, 0, m.nv*3);
    var index = new Uint16Array(buf.buffer, m.nv*6, m.ni);
    var pos = new Float32Array(m.nv*3);
    var c = [m.size[0]/2 + m.min[0], m.size[1]/2 + m.min[1], m.size[2]/2 + m.min[2]];
    var diag = Math.sqrt(m.size[0]*m.size[0] + m.size[1]*m.size[1] + m.size[2]*m.size[2]);
    var k = 120 / diag;   // normalise so every part has the same bounding-sphere diameter (120 units)
    for (var j = 0; j < pos.length; j++){
      var a = j % 3;
      pos[j] = (m.min[a] + quant[j]/65535*m.size[a] - c[a]) * k;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeVertexNormals();
    var edges = new THREE.EdgesGeometry(g, 28);
    geoCache[m.id] = {mesh: g, edges: edges};
    return geoCache[m.id];
  }

  /* scale the part so its rotated bounding box fills ~`fill` of the frame */
  function fit(s, m, aspect, fill){
    var g = geometryFor(m).mesh;
    if (!g.boundingBox) g.computeBoundingBox();
    var b = g.boundingBox, mx = 0, my = 0, v = new THREE.Vector3();
    for (var i = 0; i < 8; i++){
      v.set(i&1 ? b.max.x : b.min.x, i&2 ? b.max.y : b.min.y, i&4 ? b.max.z : b.min.z);
      v.applyEuler(s.group.rotation);
      mx = Math.max(mx, Math.abs(v.x)); my = Math.max(my, Math.abs(v.y));
    }
    var halfH = s.camera.position.z * Math.tan(Math.PI/12), halfW = halfH * aspect;
    s.holder.scale.setScalar(fill * Math.min(halfW/Math.max(mx, 1e-3), halfH/Math.max(my, 1e-3)));
  }

  function makeScene(){
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(30, 4/3, 1, 2000);
    camera.position.set(0, 0, 250);
    var mat = new THREE.MeshStandardMaterial({metalness:0.1, roughness:0.72, flatShading:true});
    var edgeMat = new THREE.LineBasicMaterial({transparent:true, opacity:0.22});
    var holder = new THREE.Group();
    var group = new THREE.Group();
    group.add(holder);
    scene.add(group);
    var hemi = new THREE.HemisphereLight(0xffffff, 0x3a4046, 0.9);
    var key = new THREE.DirectionalLight(0xffffff, 0.7); key.position.set(70, 110, 140);
    var fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-120, -60, 70);
    scene.add(hemi, key, fill);
    var s = {scene:scene, camera:camera, mat:mat, edgeMat:edgeMat, holder:holder, group:group, hemi:hemi};
    s.theme = function(){
      var dark = isDark();
      mat.color.set(dark ? 0x7E888F : 0x8B949B);
      hemi.intensity = dark ? 0.7 : 0.62;
      edgeMat.color.set(cssVar('--ink') || (dark ? '#E7EBED' : '#12171A'));
    };
    s.show = function(m){
      while (holder.children.length) holder.remove(holder.children[0]);
      var g = geometryFor(m);
      holder.add(new THREE.Mesh(g.mesh, mat));
      holder.add(new THREE.LineSegments(g.edges, edgeMat));
    };
    s.theme();
    return s;
  }

  /* ---- thumbnails ---- */
  var thumbScene = null;
  function ensureThumbRenderer(){
    if (gl !== null) return gl;
    try {
      var r = new THREE.WebGLRenderer({antialias:true, alpha:true, preserveDrawingBuffer:true});
      r.setPixelRatio(1);
      r.setSize(520, 390, false);
      gl = r;
      thumbScene = makeScene();
      thumbScene.group.rotation.set(-0.38, 0.62, 0);
      thumbScene.camera.position.z = 300;
    } catch (e) { gl = false; }
    return gl;
  }
  function renderThumb(card){
    if (!ensureThumbRenderer()) return;
    thumbScene.theme();
    thumbScene.show(card.m);
    fit(thumbScene, card.m, 520/390, 0.8);
    gl.setClearColor(0x000000, 0);
    gl.render(thumbScene.scene, thumbScene.camera);
    card.img.src = gl.domElement.toDataURL('image/png');
    card.img.hidden = false;
    card.done = true;
  }
  var io = window.IntersectionObserver ? new IntersectionObserver(function(es){
    es.forEach(function(e){
      if (e.isIntersecting){
        var c = e.target.__card;
        if (c && !c.done) renderThumb(c);
        io.unobserve(e.target);
      }
    });
  }, {rootMargin:'250px'}) : null;

  /* ---- cards ---- */
  DATA.forEach(function(m){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ccard';
    b.setAttribute('data-cat', m.cat);
    var th = document.createElement('div'); th.className = 'cthumb';
    var img = document.createElement('img'); img.alt = ''; img.hidden = true; img.width = 520; img.height = 390; img.decoding = 'async';
    th.appendChild(img);
    var name = document.createElement('span'); name.className = 'cname';
    var meta = document.createElement('span'); meta.className = 'cmeta';
    b.appendChild(th); b.appendChild(name); b.appendChild(meta);
    root.appendChild(b);
    var card = {m:m, el:b, img:img, name:name, meta:meta, done:false};
    b.__card = card;
    b.addEventListener('click', function(){ openViewer(card); });
    cards.push(card);
    if (io) io.observe(b); else renderThumb(card);
  });

  function applyFilter(){
    cards.forEach(function(c){ c.el.hidden = !(filter === 'all' || c.m.cat === filter); });
    Array.prototype.forEach.call(document.querySelectorAll('.cfilters button'), function(b){
      b.setAttribute('aria-pressed', String(b.getAttribute('data-f') === filter));
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.cfilters button'), function(b){
    b.addEventListener('click', function(){ filter = b.getAttribute('data-f'); applyFilter(); });
  });

  window.renderCollectionLang = function(l){
    lang = l;
    cards.forEach(function(c){
      var nm = c.m.n[lang] || c.m.n.lv;
      c.name.textContent = nm;
      c.meta.textContent = catText(c.m.cat) + ' · ' + dimsText(c.m.dims);
      c.el.setAttribute('aria-label', nm);
    });
    if (viewer && viewer.card) fillViewerText();
  };

  function retheme(){
    cards.forEach(function(c){ if (c.done){ c.done = false; if (io){ io.observe(c.el); } } });
    if (viewer && viewer.s) viewer.s.theme();
  }
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});

  /* ---- dialog viewer ---- */
  var dlg = document.getElementById('cdlg');
  var vbox = document.getElementById('cview');
  function fillViewerText(){
    var m = viewer.card.m;
    document.getElementById('ctitle').textContent = m.n[lang] || m.n.lv;
    document.getElementById('cinfo').textContent = catText(m.cat) + ' · ' + dimsText(m.dims);
    var t = tr('coll.note');
    document.getElementById('cnote').textContent = (t ? t[lang] : '').replace('{n}', m.tris.toLocaleString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-US' : 'lv-LV'));
  }
  function openViewer(card){
    if (!dlg || !dlg.showModal) return;
    if (!viewer){
      var r;
      try { r = new THREE.WebGLRenderer({antialias:true, alpha:true}); } catch (e) { return; }
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      vbox.appendChild(r.domElement);
      viewer = {r:r, s:makeScene(), card:null, auto:true, drag:false, raf:0};
      var px = 0, py = 0, v = viewer;
      vbox.addEventListener('pointerdown', function(e){
        v.drag = true; v.auto = false; px = e.clientX; py = e.clientY; vbox.classList.add('grabbing');
        try { vbox.setPointerCapture(e.pointerId); } catch (err) {}
      });
      vbox.addEventListener('pointermove', function(e){
        if (!v.drag) return;
        v.s.group.rotation.y += (e.clientX - px) * 0.009;
        v.s.group.rotation.x = Math.max(-1.5, Math.min(1.5, v.s.group.rotation.x + (e.clientY - py) * 0.009));
        px = e.clientX; py = e.clientY;
      });
      function end(){ v.drag = false; vbox.classList.remove('grabbing'); }
      vbox.addEventListener('pointerup', end);
      vbox.addEventListener('pointercancel', end);
      vbox.addEventListener('wheel', function(e){
        e.preventDefault();
        var z = v.s.camera.position.z * (1 + e.deltaY * 0.001);
        v.s.camera.position.z = Math.max(140, Math.min(520, z));
      }, {passive:false});
    }
    viewer.card = card;
    viewer.s.show(card.m);
    viewer.s.group.rotation.set(-0.38, 0.62, 0);
    viewer.s.camera.position.z = 300;
    fit(viewer.s, card.m, 4/3, 0.66);
    viewer.auto = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    fillViewerText();
    dlg.showModal();
    sizeViewer();
    loop();
  }
  function sizeViewer(){
    if (!viewer) return;
    var w = vbox.clientWidth, h = vbox.clientHeight;
    if (!w || !h) return;
    viewer.r.setSize(w, h);
    viewer.s.camera.aspect = w/h; viewer.s.camera.updateProjectionMatrix();
    viewer.r.render(viewer.s.scene, viewer.s.camera);
  }
  function loop(){
    if (!viewer || !dlg.open){ if (viewer) viewer.raf = 0; return; }
    viewer.raf = requestAnimationFrame(loop);
    if (viewer.auto) viewer.s.group.rotation.y += 0.006;
    viewer.r.render(viewer.s.scene, viewer.s.camera);
  }
  window.addEventListener('resize', sizeViewer);
  var closeBtn = document.getElementById('cclose');
  if (closeBtn) closeBtn.addEventListener('click', function(){ dlg.close(); });
  if (dlg) dlg.addEventListener('click', function(e){ if (e.target === dlg) dlg.close(); });

  applyFilter();
  window.renderCollectionLang(document.documentElement.lang || 'lv');
})();
