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

#import "DirectoryItem.h"

#import "CompoundItem.h"
#import "PlainFileItem.h"
#import "UniformTypeInventory.h"
#import "TreeBalancer.h"


@implementation DirectoryItem

static NSLock  *rescanFlagsMutex;

+ (void)initialize {
  rescanFlagsMutex = [[NSLock alloc] init];
}

- (instancetype) initWithLabel:(NSString *)label
                        parent:(DirectoryItem *)parent
                         flags:(FileItemOptions)flags
                  creationTime:(CFAbsoluteTime)creationTime
              modificationTime:(CFAbsoluteTime)modificationTime
                    accessTime:(CFAbsoluteTime)accessTime {
  
  if (self = [super initWithLabel: label
                           parent: parent
                             size: 0
                            flags: flags
                     creationTime: creationTime
                 modificationTime: modificationTime
                       accessTime: accessTime]) {
    _fileItems = nil;
    _directoryItems = nil;

    _rescanFlags = DirectoryIsUpToDate;
  }
  return self;
}


- (void) dealloc {
  [_fileItems release];
  [_directoryItems release];

  [super dealloc];
}

// Overrides abstract method in FileItem
- (FileItem *)duplicateFileItem:(DirectoryItem *)newParent {
  return [[[DirectoryItem alloc] initWithLabel: self.label
                                        parent: newParent
                                         flags: self.fileItemFlags
                                  creationTime: self.creationTime
                              modificationTime: self.modificationTime
                                    accessTime: self.accessTime] autorelease];
}

// Overrides abstract method in Item
- (void) visitFileItemDescendants:(void(^)(FileItem *))callback {
  callback(self);
  [_fileItems visitFileItemDescendants: callback];
  [_directoryItems visitFileItemDescendants: callback];
}

// Overrides abstract method in Item
- (FileItem *)findFileItemDescendant:(BOOL(^)(FileItem *))predicate {
  if (predicate(self)) {
    return self;
  }

  FileItem *retVal;

  retVal = [_fileItems findFileItemDescendant: predicate];
  if (retVal == nil) {
    retVal = [_directoryItems findFileItemDescendant: predicate];
  }

  return retVal;
}

// Special "setter" with additional constraints
- (void) setFileItems:(Item *)fileItems
       directoryItems:(Item *)dirItems {
  NSAssert(_fileItems == nil && _directoryItems == nil, @"Contents should only be set once.");
  
  _fileItems = [fileItems retain];
  _directoryItems = [dirItems retain];

  self.itemSize = fileItems.itemSize + dirItems.itemSize;
}

- (void) addFile:(FileItem *)fileItem {
  NSAssert(self.itemSize == 0, @"Can only add files in construction phase");
  if (_fileItems == nil) {
    _fileItems = [fileItem retain];
  } else {
    CompoundItem  *newHead = [[CompoundItem alloc] initWithFirst: fileItem second: _fileItems];
    [_fileItems release];
    _fileItems = newHead;
  }
}

- (void) addSubdir:(FileItem *)dirItem {
  NSAssert(self.itemSize == 0, @"Can only add subdirs in construction phase");
  if (_directoryItems == nil) {
    _directoryItems = [dirItem retain];
  } else {
    CompoundItem  *newHead = [[CompoundItem alloc] initWithFirst: dirItem second: _directoryItems];
    [_directoryItems release];
    _directoryItems = newHead;
  }
}

- (void) setSize {
  self.itemSize = _fileItems.itemSize + _directoryItems.itemSize;
}

- (void) balanceTree:(TreeBalancer *)treeBalancer {
  Item  *balancedFiles = [[treeBalancer convertLinkedListToTree: _fileItems] retain];
  [_fileItems release];
  _fileItems = balancedFiles;

  Item  *balancedSubdirs = [[treeBalancer convertLinkedListToTree: _directoryItems] retain];
  [_directoryItems release];
  _directoryItems = balancedSubdirs;

  NSAssert(self.itemSize == _fileItems.itemSize + _directoryItems.itemSize,
           @"Directory size changed after balancing");
}

- (void) replaceFileItems:(Item *)newItem {
  NSAssert(newItem.itemSize == self.fileItems.itemSize, @"Sizes must be equal.");

  if (_fileItems != newItem) {
    [_fileItems release];
    _fileItems = [newItem retain];
  }
}

- (void) replaceDirectoryItems:(Item *)newItem {
  NSAssert(newItem.itemSize == self.directoryItems.itemSize, @"Sizes must be equal.");

  if (_directoryItems != newItem) {
    [_directoryItems release];
    _directoryItems = [newItem retain];
  }
}

- (Item *)childItems {
  return [CompoundItem compoundItemWithFirst: _fileItems second: _directoryItems];
}

- (PlainFileItem *)directoryAsPlainFile {
  UniformType  *fileType = [UniformTypeInventory.defaultUniformTypeInventory
                            uniformTypeForExtension: self.systemPathComponent.pathExtension];

  // Note: This item is short-lived, so it is allocated in the default zone.
  return [[[PlainFileItem alloc] initWithLabel: self.label
                                        parent: self.parentDirectory
                                          size: self.itemSize
                                          type: fileType
                                         flags: self.fileItemFlags
                                  creationTime: self.creationTime
                              modificationTime: self.modificationTime
                                    accessTime: self.accessTime
          ] autorelease];
}

- (PlainFileItem *)groupedFiles {
  UniformType  *fileType = [UniformTypeInventory.defaultUniformTypeInventory
                            uniformTypeForExtension: self.systemPathComponent.pathExtension];

  return [[[PlainFileItem alloc] initWithLabel: self.label
                                        parent: self
                                          size: self.fileItems.itemSize
                                          type: fileType
                                         flags: self.fileItemFlags
                                  creationTime: self.creationTime
                              modificationTime: self.modificationTime
                                    accessTime: self.accessTime
          ] autorelease];
}

- (FileItem *)itemWhenHidingPackageContents {
  return self.isPackage ? self.directoryAsPlainFile : self;
}


- (NSString *)description {
  return [NSString stringWithFormat:
          @"DirectoryItem(%@, %qu)", self.label, self.itemSize];
}


- (file_count_t) numFiles {
  return _fileItems.numFiles + _directoryItems.numFiles;
}

- (BOOL) isDirectory {
  return YES;
}

- (BOOL) setRescanFlag:(DirectoryRescanOptions)flag {
  [rescanFlagsMutex lock];

  @try {
    if ((_rescanFlags & flag) == flag) {
      // Flag(s) are already set
      return NO;
    }

    _rescanFlags |= flag;
    return YES;
  }
  @finally {
    [rescanFlagsMutex unlock];
  }
}

- (int) maxDepth: (int)upperBound packagesAsFiles: (BOOL)packagesAsFiles {
  // Limit the bound for when recursing the sub-dir children
  --upperBound;

  // A directory is always depth one. A tree is depth zero when it consists of a single file
  __block int  maxDepth = 1;
  [CompoundItem visitFileItemChildrenMaybeNil: _directoryItems
                                     callback: ^(FileItem *dir) {
    if (maxDepth < upperBound && !(packagesAsFiles && dir.isPackage)) {
      // Only continue search if maximum has not yet been reached
      maxDepth = MAX(maxDepth, 1 + [((DirectoryItem *)dir) maxDepth: upperBound
                                                    packagesAsFiles: packagesAsFiles]);
    }
  }];

  return maxDepth;
}

@end // @implementation DirectoryItem
