/* Filesystem demo dataset — plain script; attaches to window.__data. */
(function () {
  var filesystem = {
    id: 'root', label: '/',
    children: [
      { id: 'Users', label: 'Users', children: [
        { id: 'Users/alice', label: 'alice', children: [
          { id: 'Users/alice/Docs', label: 'Documents', children: [
            { id: 'Users/alice/Docs/a.pdf',  label: 'report.pdf',  size: 520000,   kind: 'pdf' },
            { id: 'Users/alice/Docs/b.docx', label: 'thesis.docx', size: 1800000,  kind: 'doc' },
            { id: 'Users/alice/Docs/c.xlsx', label: 'budget.xlsx', size: 430000,   kind: 'xls' },
            { id: 'Users/alice/Docs/d.pptx', label: 'pitch.pptx',  size: 3900000,  kind: 'ppt' },
          ]},
          { id: 'Users/alice/Pics', label: 'Pictures', children: [
            { id: 'Users/alice/Pics/1.jpg',  label: 'IMG_0001.jpg',  size: 4700000, kind: 'jpg' },
            { id: 'Users/alice/Pics/2.jpg',  label: 'IMG_0002.jpg',  size: 3900000, kind: 'jpg' },
            { id: 'Users/alice/Pics/3.heic', label: 'IMG_0003.heic', size: 2600000, kind: 'heic' },
            { id: 'Users/alice/Pics/4.png',  label: 'screen.png',    size: 900000,  kind: 'png' },
            { id: 'Users/alice/Pics/5.raw',  label: 'shot.raw',      size: 22500000, kind: 'raw' },
          ]},
          { id: 'Users/alice/Music', label: 'Music', children: [
            { id: 'Users/alice/Music/s1.mp3', label: 'track01.mp3', size: 6200000,  kind: 'mp3' },
            { id: 'Users/alice/Music/s2.mp3', label: 'track02.mp3', size: 5400000,  kind: 'mp3' },
            { id: 'Users/alice/Music/s3.flac', label: 'live.flac',  size: 42000000, kind: 'flac' },
          ]},
          { id: 'Users/alice/Code', label: 'Code', children: [
            { id: 'Users/alice/Code/app', label: 'app', children: [
              { id: 'Users/alice/Code/app/a.js',  label: 'index.js',  size: 120000, kind: 'js' },
              { id: 'Users/alice/Code/app/b.js',  label: 'router.js', size: 38000,  kind: 'js' },
              { id: 'Users/alice/Code/app/c.ts',  label: 'state.ts',  size: 46000,  kind: 'ts' },
              { id: 'Users/alice/Code/app/d.css', label: 'theme.css', size: 21000,  kind: 'css' },
            ]},
            { id: 'Users/alice/Code/node', label: 'node_modules', children: [
              { id: 'Users/alice/Code/node/lodash', label: 'lodash',     size: 12400000, kind: 'lib' },
              { id: 'Users/alice/Code/node/react',  label: 'react',      size:  6500000, kind: 'lib' },
              { id: 'Users/alice/Code/node/ts',     label: 'typescript', size: 34000000, kind: 'lib' },
              { id: 'Users/alice/Code/node/webp',   label: 'webpack',    size: 19000000, kind: 'lib' },
            ]},
          ]},
        ]},
        { id: 'Users/bob', label: 'bob', children: [
          { id: 'Users/bob/Movies', label: 'Movies', children: [
            { id: 'Users/bob/Movies/m1', label: 'vacation.mov', size: 820000000, kind: 'mov' },
            { id: 'Users/bob/Movies/m2', label: 'wedding.mov',  size: 540000000, kind: 'mov' },
          ]},
          { id: 'Users/bob/Archive', label: 'Archive', children: [
            { id: 'Users/bob/Archive/z1', label: 'backup2023.zip', size: 1400000000, kind: 'zip' },
            { id: 'Users/bob/Archive/z2', label: 'photos.tar.gz',  size:  820000000, kind: 'zip' },
          ]},
        ]},
      ]},
      { id: 'Applications', label: 'Applications', children: [
        { id: 'Applications/chrome', label: 'Chrome.app',    size:   540000000, kind: 'app' },
        { id: 'Applications/xcode',  label: 'Xcode.app',     size: 16000000000, kind: 'app' },
        { id: 'Applications/ps',     label: 'Photoshop.app', size:  2400000000, kind: 'app' },
        { id: 'Applications/figma',  label: 'Figma.app',     size:   290000000, kind: 'app' },
        { id: 'Applications/slack',  label: 'Slack.app',     size:   230000000, kind: 'app' },
      ]},
      { id: 'System', label: 'System', children: [
        { id: 'System/Library', label: 'Library', children: [
          { id: 'System/Library/Fwk',   label: 'Frameworks',        size: 12000000000, kind: 'sys' },
          { id: 'System/Library/Priv',  label: 'PrivateFrameworks', size:  6000000000, kind: 'sys' },
          { id: 'System/Library/Kexts', label: 'Extensions',        size:  2300000000, kind: 'sys' },
        ]},
      ]},
    ],
  };

  window.__data = window.__data || {};
  window.__data.flattenFilesystem = function () {
    var labels = [], parents = [], values = [], ids = [], color = [];
    (function walk(node, parentId) {
      labels.push(node.label);
      parents.push(parentId || '');
      values.push(node.size || 0);
      ids.push(node.id);
      color.push(node.kind || '');
      if (node.children) for (var i = 0; i < node.children.length; i++) walk(node.children[i], node.id);
    })(filesystem, '');
    return { labels: labels, parents: parents, values: values, ids: ids, color: color };
  };
})();
