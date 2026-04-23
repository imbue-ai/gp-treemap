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

#import <Cocoa/Cocoa.h>

#import "TreeLayoutTraverser.h"

@class FileItem;
@class ItemPathModelView;
@class TreeLayoutBuilder;


@interface ItemPathDrawer : NSObject <TreeLayoutTraverser> {
  BOOL  highlightPathEndPoint;

  //------------------------------------------------------------------------------------------------
  // All variables below are temporary variables only used for drawing the path They are not
  // retained, as they are only used during a single recursive invocation.
   
  NSArray  *drawPath;
  unsigned int  drawPathIndex;
  
  FileItem  *targetItem;
  
  FileItem  *visibleTree;
  BOOL  insideVisibleTree;

  // The rectangle of the previous item on the visible selected path. When the width is negative, it
  // is still unset (i.e. the previous selected item is not yet on the visible path).
  NSRect  prevRect;
  NSRect  outerRect;
}

- (void) setHighlightPathEndPoint:(BOOL)option;

/* Draws the part of the path that is visible in the tree. The path may include invisible items, not
 * shown in the tree. However, the path must always include the root of the tree.
 *
 * The endRect is passed to enable animation. As it transitions from a previous position it will
 * not actually match the rectangle of the actual end point.
 */
- (void) drawVisiblePath:(ItemPathModelView *)pathModelView
          startingAtTree:(FileItem *)treeRoot
             withEndRect:(NSRect)endRect
      usingLayoutBuilder:(TreeLayoutBuilder *)layoutBuilder
                  bounds:(NSRect)bounds;

@end
