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

#import "ItemPathBuilder.h"

#import "DirectoryItem.h"
#import "ItemPathModel.h"
#import "TreeLayoutBuilder.h"


@implementation ItemPathBuilder

- (FileItem *)itemAtPoint:(NSPoint)point
           startingAtTree:(FileItem *)treeRoot
       usingLayoutBuilder:(TreeLayoutBuilder *)layoutBuilder
                   bounds:(NSRect)bounds
               updatePath:(ItemPathModel *)pathModelVal {
  NSAssert(pathModel == nil, @"Path model should be nil.");
  pathModel = pathModelVal;
  visibleTree = pathModel.visibleTree;

  @try {
    [pathModel clearVisiblePath];
    insideVisibleTree = NO;

    return [self itemAtPoint: point
              startingAtTree: treeRoot
          usingLayoutBuilder: layoutBuilder
                      bounds: bounds];
  }
  @finally {
    visibleTree = nil;
    pathModel = nil;
  }
}

- (FileItem *)itemAtPoint:(NSPoint)point
           startingAtTree:(FileItem *)treeRoot
       usingLayoutBuilder:(TreeLayoutBuilder *)layoutBuilder
                   bounds:(NSRect)bounds {
  NSAssert(foundItem == nil, @"foundItem should be nil.");
  
  targetPoint = point;

  [layoutBuilder layoutItemTree: treeRoot inRect: bounds traverser: self];
  
  FileItem  *retVal = foundItem;
  foundItem = nil;
  return retVal;
}


- (BOOL) descendIntoItem:(Item *)item atRect:(NSRect)rect depth:(int)depth {
  if (!NSPointInRect(targetPoint, rect)) {
    return NO;
  }
  
  if (pathModel != nil) {
    if (item == visibleTree) {
      insideVisibleTree = YES;
    }
    else if (insideVisibleTree) {
      // Note: Append the visible item which is not the visible tree root itself) to the path.
      [pathModel extendVisiblePath: item];
    }
  }

  if (!item.isVirtual) {
    foundItem = (FileItem *)item;
  }
  
  return YES;
}

- (void) emergedFromItem:(Item*)item {
  if (item == visibleTree) {
    insideVisibleTree = NO;
  }
}

@end // @implementation ItemPathBuilder
