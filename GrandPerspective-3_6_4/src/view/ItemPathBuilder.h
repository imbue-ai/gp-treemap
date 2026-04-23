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
@class ItemPathModel;
@class TreeLayoutBuilder;

@interface ItemPathBuilder : NSObject <TreeLayoutTraverser> {
  // All variables below are temporary variables used while building the path. They are not
  // retained, as they are only used during a single recursive invocation.

  FileItem  *foundItem;
  ItemPathModel  *pathModel;
  NSPoint  targetPoint;
  
  FileItem  *visibleTree;
  BOOL  insideVisibleTree;
}

/* Returns the item that is located at the given point (given the tree drawing settings specified by
 * treeRoot, layoutBuilder and bounds).
 */
- (FileItem *)itemAtPoint:(NSPoint)point
           startingAtTree:(FileItem *)treeRoot
       usingLayoutBuilder:(TreeLayoutBuilder *)layoutBuilder
                   bounds:(NSRect)bounds;

/* Returns the item that is located at the given point. Furthermore, if the item is inside the
 * visible tree, the visible path is also extended to end at this item.
 */
- (FileItem *)itemAtPoint:(NSPoint)point
           startingAtTree:(FileItem *)treeRoot
       usingLayoutBuilder:(TreeLayoutBuilder *)layoutBuilder
                   bounds:(NSRect)bounds
               updatePath:(ItemPathModel *)pathModel;
@end
