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

#import "TreeDrawerBase.h"

#import "DirectoryItem.h"
#import "PlainFileItem.h"
#import "FilteredTreeGuide.h"
#import "GradientRectangleDrawer.h"
#import "TreeLayoutBuilder.h"
#import "TreeContext.h"
#import "TreeDrawerSettings.h"

@implementation TreeDrawerBase

- (instancetype) initWithScanTree:(DirectoryItem *)scanTreeVal {
  return [self initWithScanTree: scanTreeVal colorPalette: nil];
}

- (instancetype) initWithScanTree:(DirectoryItem *)scanTreeVal
                     colorPalette:(NSColorList *)colorPalette {
  if (self = [super init]) {
    scanTree = [scanTreeVal retain];
    rectangleDrawer = [[GradientRectangleDrawer alloc] initWithColorPalette: colorPalette];

    treeGuide = [[FilteredTreeGuide alloc] init];

    abort = NO;
  }
  return self;
}

- (void) dealloc {
  [treeGuide release];
  [scanTree release];
  [rectangleDrawer release];

  [super dealloc];
}


- (void) setShowPackageContents:(BOOL)showPackageContents {
  [treeGuide setPackagesAsFiles: !showPackageContents];
}

- (BOOL) showPackageContents {
  return !treeGuide.packagesAsFiles;
}


- (void) updateSettings:(TreeDrawerBaseSettings *)settings {
  [self setShowPackageContents: settings.drawItems == DRAW_FILES];
  self.groupFiles = settings.drawItems == DRAW_FOLDERS;
  self.displayDepth = settings.displayDepth;
}


- (NSImage *)drawImageOfVisibleTree:(FileItem *)visibleTreeVal
                     startingAtTree:(FileItem *)treeRoot
                 usingLayoutBuilder:(TreeLayoutBuilder *)layoutBuilder
                             inRect:(NSRect)bounds {
  [rectangleDrawer setupBitmap: bounds];

  insideVisibleTree = NO;
  visibleTree = visibleTreeVal;

  [layoutBuilder layoutItemTree: treeRoot inRect: bounds traverser: self];

  visibleTree = nil;

  if (!abort) {
    return [rectangleDrawer createImageFromBitmap];
  }
  else {
    [rectangleDrawer releaseBitmap];

    return nil;
  }
}

- (void) clearAbortFlag {
  abort = NO;
}

- (void) abortDrawing {
  abort = YES;
}


- (BOOL) descendIntoItem:(Item *)item atRect:(NSRect)rect depth:(int)depth {
  if (item == nextFilesToGroup) {
    [self drawFileItem: groupFilesDir.groupedFiles atRect: rect depth: depth];
    nextFilesToGroup = nil;

    return NO;
  }

  if (item.isVirtual) {
    return YES;
  }

  FileItem  *file = (FileItem *)item;

  if (file == visibleTree) {
    insideVisibleTree = YES;

    [self drawVisibleTreeAtRect: rect];

    // Check if any ancestors are masked
    FileItem  *ancestor = file;
    while (ancestor != scanTree) {
      ancestor = ancestor.parentDirectory;
      if (! [treeGuide includeFileItem: ancestor]) {
        return NO;
      }
    }
  }

  if (!insideVisibleTree) {
    // Not yet inside the visible tree (implying that the entire volume is shown). Ensure that the
    // special "volume" items are drawn, and only descend towards the visible tree.

    if (file.isDirectory) {
      if (!file.isPhysical && [file.label isEqualToString: UsedSpace]) {
        [self drawUsedSpaceAtRect: rect];
      }

      if ([file isAncestorOfFileItem: visibleTree]) {
        [treeGuide descendIntoDirectory: (DirectoryItem *)file];
        return YES;
      }
    }
    else if (!file.isPhysical && [file.label isEqualToString: FreeSpace]) {
      [self drawFreeSpaceAtRect: rect];
    }

    return NO;
  }

  // Inside the visible tree. Check if the item is masked
  file = [treeGuide includeFileItem: file];
  if (file == nil) {
    return NO;
  }

  if (file.isDirectory) {
    if (abort) {
      return NO;
    }

    if (depth == self.displayDepth) {
      if ([treeGuide includeFileItem: ((DirectoryItem *)file).directoryAsPlainFile]) {
        [self drawFileItem: file atRect: rect depth: depth];
      }

      return NO;
    }

    [treeGuide descendIntoDirectory: (DirectoryItem *)file];

    if (self.groupFiles) {
      groupFilesDir = (DirectoryItem *)file;
      nextFilesToGroup = groupFilesDir.fileItems;
    }

    return YES;
  }

  // It's a plain file
  if (file.isPhysical) {
    [self drawFileItem: file atRect: rect depth: depth];
  }
  else {
    if ([file.label isEqualToString: FreedSpace]) {
      [self drawFreedSpaceAtRect: rect];
    }
  }

  if (item == visibleTree) {
    // Note: emergedFromItem: will not be invoked, so unset the flag here.
    insideVisibleTree = NO;
  }

  // Do not descend into the item.
  //
  // Note: This is not just an optimisation but needs to be done. Even though the item is seen as a
  // file by the TreeDrawer, it may actually be a package whose contents are hidden. The
  // TreeLayoutBuilder should not descend into the directory in this case.
  return NO;
}

- (void) emergedFromItem:(Item *)item {
  if (!item.isVirtual) {
    if (item == visibleTree) {
      insideVisibleTree = NO;
    }

    if (((FileItem *)item).isDirectory) {
      [treeGuide emergedFromDirectory: (DirectoryItem *)item];
    }
  }
}

@end

@implementation TreeDrawerBase (ProtectedMethods)

// Provide default empty implementation
- (void) drawVisibleTreeAtRect:(NSRect) rect {}
- (void) drawUsedSpaceAtRect:(NSRect) rect {}
- (void) drawFreeSpaceAtRect:(NSRect) rect {}
- (void) drawFreedSpaceAtRect:(NSRect) rect {}
- (void) drawFileItem:(FileItem *)fileItem atRect:(NSRect) rect depth:(int) depth {}

@end
