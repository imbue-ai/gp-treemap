/* Budget demo dataset — plain script; attaches to window.__data. */
(function () {
  window.__data = window.__data || {};
  window.__data.flattenBudget = function () {
    var rows = [
      ['FY25','',                12000,   0.0],
      ['Engineering','FY25',      5400,   4.0],
      ['Platform','Engineering',  2100,   6.0],
      ['APIs','Platform',          900,   9.0],
      ['Data','Platform',          800,   2.0],
      ['Infra','Platform',         400,   8.0],
      ['Product','Engineering',   1800,   1.0],
      ['Web','Product',            900,   0.0],
      ['Mobile','Product',         700,  -3.0],
      ['ML','Product',             200,  12.0],
      ['QA','Engineering',         900,   4.0],
      ['Security','Engineering',   600,  10.0],
      ['Sales','FY25',            2800,  -2.0],
      ['NA','Sales',              1200,  -1.0],
      ['EMEA','Sales',             900,  -4.0],
      ['APAC','Sales',             700,  -6.0],
      ['Marketing','FY25',        1400,   1.5],
      ['Brand','Marketing',        600,   0.0],
      ['Demand','Marketing',       800,   3.0],
      ['G&A','FY25',              1200,  -1.0],
      ['Finance','G&A',            400,   0.0],
      ['HR','G&A',                 400,  -3.0],
      ['Legal','G&A',              400,   0.0],
      ['R&D','FY25',              1200,   7.0],
      ['Labs','R&D',               700,  12.0],
      ['Research','R&D',           500,   0.0],
    ];
    var labels = [], parents = [], values = [], ids = [], color = [];
    for (var i = 0; i < rows.length; i++) {
      labels.push(rows[i][0]); parents.push(rows[i][1]); values.push(rows[i][2]);
      ids.push(rows[i][0]); color.push(rows[i][3]);
    }
    return { labels: labels, parents: parents, values: values, ids: ids, color: color };
  };
})();
