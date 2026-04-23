/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "ItemPathDrawer.h"

#import "FileItem.h"
#import "TreeLayoutBuilder.h"
#import "ItemPathModel.h"
#import "ItemPathModelView.h"


@implementation ItemPathDrawer

- (void) setHighlightPathEndPoint:(BOOL)option {
  highlightPathEndPoint = option;
}

- (void) drawVisiblePath:(ItemPathModelView *)pathModelView
          startingAtTree:(FileItem *)treeRoot
             withEndRect:(NSRect)endRect
      usingLayoutBuilder:(TreeLayoutBuilder *)layoutBuilder
                  bounds:(NSRect)bounds {

  NSAssert(drawPath == nil, @"drawPath should be nil.");
  drawPath = pathModelView.pathModel.itemPath;
    // Not retaining it. It is only needed during this method.

  // Align the path with the tree, as the path may contain invisible items not part of the tree.
  drawPathIndex = 0;
  while (drawPath[drawPathIndex] != treeRoot) {
    drawPathIndex++;
    
    NSAssert(drawPathIndex < drawPath.count, @"treeRoot not found in path.");
  }
  
  targetItem = pathModelView.selectedFileItemInTree;
  
  NSAssert(visibleTree == nil, @"visibleTree should be nil.");
  visibleTree = pathModelView.visibleTree;
  insideVisibleTree = NO;

  prevRect.size.width = -1; // Indicate that it is not yet valid
  outerRect.size.width = -1; // Indicate that it is not yet valid

  
  [layoutBuilder layoutItemTree: treeRoot inRect: bounds traverser: self];
  
  // Draw the end-point rectangle, except when there isn't one, or it is equal to the outermost
  // rectangle and it is not highlighted. This way, there is not unnecessarily a border around the
  // view, which is visually more appealing, especially in the case where the mouse is outside the
  // view and the selection is actually cleared. When highlighted, the endpoint is always drawn and
  // clearly visible, even when some/all borders align with the view's bounds, given that the bounds
  // are not expanded.
  if (!NSIsEmptyRect(endRect) && (! NSEqualRects(endRect, outerRect) || highlightPathEndPoint)) {
    float fraction = 0.8 + 0.2 * sin([NSDate date].timeIntervalSinceReferenceDate * 3.1415);
    [[NSColor.selectedControlColor highlightWithLevel: fraction] set];

    NSBezierPath  *path = [NSBezierPath bezierPathWithRect: endRect];
    
    path.lineWidth = (highlightPathEndPoint ? 3 : 2);
    [path stroke];
  }

  drawPath = nil;
  visibleTree = nil;
  targetItem = nil;
}


- (BOOL) descendIntoItem:(Item *)item atRect:(NSRect) rect depth:(int)depth {
  if (outerRect.size.width < 0) {
    outerRect = rect;
  }
           
  if (drawPathIndex >= drawPath.count || drawPath[drawPathIndex] != item) {
    return NO;
  }
  drawPathIndex++;

  if (!item.isVirtual) {
    if (item == visibleTree) {
      insideVisibleTree = YES;
    }
  
    if (insideVisibleTree) {
      if (prevRect.size.width > 0) {
        // This is not the end-point, so give it the secondary color and expand it slightly (this
        // way, edges that border the view are not shown, which is visually more attractive; it may
        // happen that the entire bezier path falls outside the view and is invisible, but that is
        // okay, because it is not the endpoint. The endpoint definitely needs to be shown to
        // provide the user with visual feedback needed to move the focus and to lock and unlock the
        // selection)

        [NSColor.selectedControlColor set];

        NSRect  drawRect = NSMakeRect(prevRect.origin.x - 1,
                                      prevRect.origin.y - 1,
                                      prevRect.size.width + 2,
                                      prevRect.size.height + 2);
        NSBezierPath  *path = [NSBezierPath bezierPathWithRect: drawRect];

        path.lineWidth = 2;
        [path stroke];
      }

      prevRect = rect;
    }
  }

  return (item != targetItem);
}

- (void) emergedFromItem:(Item *)item {
  if (item == visibleTree) {
    insideVisibleTree = NO;
  }
}

@end // @implementation ItemPathDrawer
