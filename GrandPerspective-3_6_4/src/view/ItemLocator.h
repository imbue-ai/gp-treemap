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

#import <Foundation/Foundation.h>

#import "TreeLayoutTraverser.h"

@class FileItem;
@class ItemPathModelView;
@class TreeLayoutBuilder;

@interface ItemLocator : NSObject <TreeLayoutTraverser> {
  // All variables below are temporary variables used while building the path. They are not
  // retained, as they are only used during a single recursive invocation.

  NSArray  *path;
  FileItem  *targetItem;
  unsigned int  pathIndex;
  NSRect  itemLocation;
}

- (NSRect) locationForItem:(FileItem *)item
                    onPath:(NSArray *)itemPath
            startingAtTree:(FileItem *)treeRoot
        usingLayoutBuilder:(TreeLayoutBuilder *)layoutBuilder
                    bounds:(NSRect)bounds;

@end
