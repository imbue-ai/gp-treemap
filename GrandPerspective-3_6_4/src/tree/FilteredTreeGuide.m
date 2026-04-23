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

#import "FilteredTreeGuide.h"

#import "DirectoryItem.h"
#import "FileItemTest.h"
#import "FileItemPathStringCache.h"
#import "ItemSizeTestFinder.h"


@implementation FilteredTreeGuide

// Overrides designated initialiser
- (instancetype) init {
  return [self initWithFileItemTest: nil];
}

- (instancetype) initWithFileItemTest:(FileItemTest *)itemTestVal {
  return [self initWithFileItemTest: itemTestVal packagesAsFiles: NO];
}

- (instancetype) initWithFileItemTest:(FileItemTest *)itemTestVal
                      packagesAsFiles:(BOOL)packagesAsFilesVal {
  if (self = [super init]) {
    itemTest = nil;
    testUsesSize = NO;
    [self setFileItemTest: itemTestVal];

    packagesAsFiles = packagesAsFilesVal;
    
    packageCount = 0;
    
    fileItemPathStringCache = [[FileItemPathStringCache alloc] init];
    [fileItemPathStringCache setAddTrailingSlashToDirectoryPaths: YES];
  }

  return self;
}

- (void) dealloc {
  [itemTest release];
  [fileItemPathStringCache release];
  
  [super dealloc];
}


- (BOOL) packagesAsFiles {
  return packagesAsFiles;
}

- (void) setPackagesAsFiles:(BOOL)flag {
  packagesAsFiles = flag;
}


- (FileItemTest *)fileItemTest {
  return itemTest;
}

- (void) setFileItemTest:(FileItemTest *)test {
  if (itemTest != test) {
    [itemTest release];
    itemTest = [test retain];
    
    // Check if the test includes an ItemSizeTest
    if (itemTest != nil) {
      ItemSizeTestFinder  *sizeTestFinder = [[[ItemSizeTestFinder alloc] init] autorelease];
      
      [test acceptFileItemTestVisitor: sizeTestFinder];
      testUsesSize = sizeTestFinder.itemSizeTestFound;
    }
    else {
      testUsesSize = NO;
    }
  }
}


- (FileItem *) includeFileItem: (FileItem *)item {
  if (item.itemSize == 0) {
    // Never include zero-sized items (as they are not visible)
    return nil;
  }

  FileItem  *proxyItem = item; // Default

  if (item.isDirectory) {
    if (packagesAsFiles) {
      proxyItem = ((DirectoryItem *)item).itemWhenHidingPackageContents;
    }
  }
  else {
    // It's a plain file
    
    if (!item.isPhysical) {
      // Exclude all special items (inside the volume tree, these all represent freed space).
      //
      // TO DO: Check if special items should still always be excluded.

      return nil; 
    }
  }

  if (packagesAsFiles && packageCount > 0) {
    // Currently inside opaque package (implying that a tree is being constructed). Include all
    // items.
    return proxyItem;
  }

  if (itemTest == nil || [itemTest testFileItem: proxyItem
                                        context: fileItemPathStringCache] != TestFailed) {
    // The item passed the test.
    return proxyItem;
  }
  
  return nil;
}


- (BOOL) shouldDescendIntoDirectory:(DirectoryItem *)item {
  FileItem  *proxyItem = item; // Default
  
  if (packagesAsFiles) {
    if (testUsesSize) {
      // The test considers the file's size. This means that the item should be constructed first
      // before applying the test.
      return YES;
    }
    else {
      // Even though the directory has not yet been constructed, the test can be applied to its
      // plain file proxy.
      proxyItem = ((DirectoryItem *)item).itemWhenHidingPackageContents;
    }
  }

  // Even though the directory item has not yet been fully created, the test can be applied already.
  // So only descend (and construct the contents) when it passed the test (and will be included in
  // the tree).
  return (itemTest == nil || [itemTest testFileItem: proxyItem
                                            context: fileItemPathStringCache] != TestFailed);
}


- (void) descendIntoDirectory:(DirectoryItem *)item { 
  if (item.isPackage) {
    packageCount++;
  }
}

- (void) emergedFromDirectory:(DirectoryItem *)item {
  if (item.isPackage) {
    NSAssert(packageCount > 0, @"Count should be positive." );
    packageCount--;
  }
}

@end // @implementation FilteredTreeGuide
