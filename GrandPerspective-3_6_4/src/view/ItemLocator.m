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

#import "ItemLocator.h"

#import "FileItem.h"
#import "ItemPathModel.h"
#import "ItemPathModelView.h"
#import "TreeLayoutBuilder.h"


@implementation ItemLocator

- (NSRect) locationForItem:(FileItem *)item
                    onPath:(NSArray *)itemPath
            startingAtTree:(FileItem *)treeRoot
        usingLayoutBuilder:(TreeLayoutBuilder *)layoutBuilder
                    bounds:(NSRect)bounds {
  itemLocation = NSZeroRect;

  NSAssert(path == nil, @"path should be nil");
  path = itemPath; // Not retaining it. It is only needed during this method.
  targetItem = item;

  // Align the path with the tree, as the path may contain invisible items not part of the tree.
  pathIndex = 0;
  while (path[pathIndex] != treeRoot) {
    pathIndex++;

    NSAssert(pathIndex < path.count, @"treeRoot not found in path.");
  }

  [layoutBuilder layoutItemTree: treeRoot inRect: bounds traverser: self];

  path = nil;
  targetItem = nil;

  return itemLocation;
}

- (BOOL) descendIntoItem:(Item *)item atRect:(NSRect)rect depth:(int)depth {
  if (pathIndex >= path.count || path[pathIndex] != item) {
    return NO;
  }

  pathIndex++;
  itemLocation = rect;

  return item != targetItem;
}

- (void) emergedFromItem: (Item *)item {
  // void
}

@end
