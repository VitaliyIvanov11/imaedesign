/* Collection: simplified STL models rendered as lazy thumbnails (one shared WebGL context) +  */
(function(){
  var DATA = window.COLLECTION || [];
  var root = document.getElementById('coll');
  if (!root || !DATA.length) return;

  var lang = 'lv';
  var filter = 'all';
  var cards = [];
  var geoCache = {};
  var gl = null;           // shared offscreen renderer for thumbnails

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

  /* smooth normals that stop at sharp edges: a corner only averages faces within `crease` degrees of its own */
  function creasedGeometry(pos, index, crease){
    var nf = index.length / 3, cosT = Math.cos(crease * Math.PI / 180);
    var fn = new Float32Array(nf*3), adj = [], i, f, c;
    for (i = 0; i < pos.length/3; i++) adj.push([]);
    for (f = 0; f < nf; f++){
      var a = index[f*3]*3, b = index[f*3+1]*3, d = index[f*3+2]*3;
      var ux = pos[b]-pos[a], uy = pos[b+1]-pos[a+1], uz = pos[b+2]-pos[a+2];
      var vx = pos[d]-pos[a], vy = pos[d+1]-pos[a+1], vz = pos[d+2]-pos[a+2];
      fn[f*3] = uy*vz-uz*vy; fn[f*3+1] = uz*vx-ux*vz; fn[f*3+2] = ux*vy-uy*vx;
      adj[index[f*3]].push(f); adj[index[f*3+1]].push(f); adj[index[f*3+2]].push(f);
    }
    var P = new Float32Array(nf*9), N = new Float32Array(nf*9);
    for (f = 0; f < nf; f++){
      var fx = fn[f*3], fy = fn[f*3+1], fz = fn[f*3+2], fl = Math.sqrt(fx*fx+fy*fy+fz*fz) || 1;
      for (c = 0; c < 3; c++){
        var vi = index[f*3+c], list = adj[vi], sx = 0, sy = 0, sz = 0;
        for (var k = 0; k < list.length; k++){
          var g = list[k], gx = fn[g*3], gy = fn[g*3+1], gz = fn[g*3+2], gl = Math.sqrt(gx*gx+gy*gy+gz*gz) || 1;
          if ((fx*gx + fy*gy + fz*gz) / (fl*gl) >= cosT){ sx += gx/gl; sy += gy/gl; sz += gz/gl; }
        }
        var sl = Math.sqrt(sx*sx+sy*sy+sz*sz) || 1, o = f*9 + c*3;
        N[o] = sx/sl; N[o+1] = sy/sl; N[o+2] = sz/sl;
        P[o] = pos[vi*3]; P[o+1] = pos[vi*3+1]; P[o+2] = pos[vi*3+2];
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    return geo;
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
    var ig = new THREE.BufferGeometry();
    ig.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ig.setIndex(new THREE.BufferAttribute(index, 1));
    var edges = new THREE.EdgesGeometry(ig, 35);
    var g = creasedGeometry(pos, index, 35);
    g.computeBoundingBox();
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
    var mat = new THREE.MeshStandardMaterial({metalness:0.1, roughness:0.62, flatShading:false});
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
    var b = document.createElement('div');
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
  };

  function retheme(){
    cards.forEach(function(c){ if (c.done){ c.done = false; if (io){ io.observe(c.el); } } });
  }
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});

  applyFilter();
  window.renderCollectionLang(document.documentElement.lang || 'lv');
})();
