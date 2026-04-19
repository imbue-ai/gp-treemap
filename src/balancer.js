// Balanced binary grouping of sized items, GP-style: always merge the two
// smallest remaining subtrees. Result is a binary tree whose leaves are the
// original items and whose internal nodes carry cumulative size.

// A tiny index-based min-heap keyed by `size` (ties broken by insertion order
// to keep the ordering deterministic for tests).
class MinHeap {
  constructor() { this.arr = []; this.counter = 0; }
  push(node) {
    const entry = { node, seq: this.counter++ };
    this.arr.push(entry);
    this._up(this.arr.length - 1);
  }
  pop() {
    const top = this.arr[0];
    const last = this.arr.pop();
    if (this.arr.length) { this.arr[0] = last; this._down(0); }
    return top ? top.node : null;
  }
  size() { return this.arr.length; }
  _lt(a, b) {
    if (a.node.size !== b.node.size) return a.node.size < b.node.size;
    return a.seq < b.seq;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._lt(this.arr[i], this.arr[p])) {
        [this.arr[i], this.arr[p]] = [this.arr[p], this.arr[i]];
        i = p;
      } else break;
    }
  }
  _down(i) {
    const n = this.arr.length;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let best = i;
      if (l < n && this._lt(this.arr[l], this.arr[best])) best = l;
      if (r < n && this._lt(this.arr[r], this.arr[best])) best = r;
      if (best === i) break;
      [this.arr[i], this.arr[best]] = [this.arr[best], this.arr[i]];
      i = best;
    }
  }
}

/**
 * @param {{id:string, size:number}[]} items
 * @returns {BalancerNode|null}
 */
export function balanceChildren(items) {
  if (!items.length) return null;
  if (items.length === 1) {
    const it = items[0];
    return { id: it.id, size: it.size, isLeaf: true, left: null, right: null };
  }
  const heap = new MinHeap();
  for (const it of items) {
    heap.push({ id: it.id, size: it.size, isLeaf: true, left: null, right: null });
  }
  while (heap.size() > 1) {
    const a = heap.pop();
    const b = heap.pop();
    heap.push({
      id: null,
      size: a.size + b.size,
      isLeaf: false,
      // left = the smaller-or-equal one so child ordering is stable
      left: a, right: b,
    });
  }
  return heap.pop();
}

// Max depth of the balancer tree (for tests).
export function maxDepth(node) {
  if (!node) return 0;
  if (node.isLeaf) return 1;
  return 1 + Math.max(maxDepth(node.left), maxDepth(node.right));
}
