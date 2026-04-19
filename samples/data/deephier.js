/* Deep-hierarchy demo (5 levels, ~960 leaves) — plain script. */
(function () {
  window.__data = window.__data || {};
  window.__data.flattenDeepHier = function () {
    var labels = [], parents = [], values = [], ids = [];
    function add(id, label, parentId, value) {
      ids.push(id); labels.push(label); parents.push(parentId || ''); values.push(value);
    }
    var s = 1337;
    function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    add('root', 'life', '', 0);
    var kingdoms = ['Animalia','Plantae','Fungi','Protista','Monera'];
    for (var ki = 0; ki < kingdoms.length; ki++) {
      var k = kingdoms[ki];
      var kid = 'root/' + k; add(kid, k, 'root', 0);
      for (var p = 0; p < 4; p++) {
        var pid = kid + '/P' + p; add(pid, 'Phylum-' + p, kid, 0);
        for (var c = 0; c < 3; c++) {
          var cid = pid + '/C' + c; add(cid, 'Class-' + c, pid, 0);
          for (var o = 0; o < 4; o++) {
            var oid = cid + '/O' + o; add(oid, 'Order-' + o, cid, 0);
            for (var sp = 0; sp < 4; sp++) {
              var sid = oid + '/S' + sp;
              add(sid, 'sp.' + sp, oid, 10 + Math.floor(rnd() * 200));
            }
          }
        }
      }
    }
    return { labels: labels, parents: parents, values: values, ids: ids };
  };
})();
