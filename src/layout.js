// Slice-and-dice layout on a pre-balanced binary tree.
//
// Each call assigns a rect to the subtree. Internal (balancer) nodes are split;
// the ratio is (left.size / node.size). We split along the longer axis.
// Visibility check: the rect must enclose at least one integer pixel
// center, i.e. floor(x + w + 0.5) - floor(x + 0.5) > 0.
// When a rect fails the visibility check we simply stop recursing.

/**
 * @param {BalancerNode} root
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {(leafId:string, rect:{x,y,w,h}) => void} onLeaf
 * @param {number} minArea optional early-cutoff on w*h
 */
export function layoutTree(root, rect, onLeaf, minArea = 0) {
  if (!root) return;
  if (!visible(rect)) return;
  if (rect.w * rect.h < minArea) return;
  if (root.isLeaf) {
    onLeaf(root.id, rect);
    return;
  }
  const ratio = root.size > 0 ? root.left.size / root.size : 0.5;
  let r1, r2;
  if (rect.w > rect.h) {
    const w1 = ratio * rect.w;
    r1 = { x: rect.x, y: rect.y, w: w1, h: rect.h };
    r2 = { x: rect.x + w1, y: rect.y, w: rect.w - w1, h: rect.h };
  } else {
    const h1 = ratio * rect.h;
    r1 = { x: rect.x, y: rect.y, w: rect.w, h: h1 };
    r2 = { x: rect.x, y: rect.y + h1, w: rect.w, h: rect.h - h1 };
  }
  layoutTree(root.left, r1, onLeaf, minArea);
  layoutTree(root.right, r2, onLeaf, minArea);
}

function visible(rect) {
  const dx = Math.floor(rect.x + rect.w + 0.5) - Math.floor(rect.x + 0.5);
  const dy = Math.floor(rect.y + rect.h + 0.5) - Math.floor(rect.y + 0.5);
  return dx > 0 && dy > 0;
}
