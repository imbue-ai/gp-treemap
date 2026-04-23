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

#import "TreeContext.h"

#import "DirectoryItem.h"
#import "CompoundItem.h"

#import "ItemPathModel.h"
#import "ItemPathModelView.h"

#import "FilterSet.h"
#import "TreeMonitor.h"

extern NSString  *TallyFileSizeName;

NSString  *FreeSpace = @"free";
NSString  *UsedSpace = @"used";
NSString  *MiscUsedSpace = @"misc used";
NSString  *FreedSpace = @"freed";

NSString  *FileItemDeletedEvent = @"fileItemDeleted";
NSString  *FileItemDeletedHandledEvent = @"fileItemDeletedHandled";

typedef NS_ENUM(NSInteger, LockConditionEnum) {
  ConditionIdle = 100,
  ConditionReading = 101,
  ConditionWriting = 102
};


@interface TreeContext (PrivateMethods)

/* Returns the item that owns the selected file item, i.e. the one directly above it in the tree.
 * This can be a virtual item.
 */
- (Item *)itemContainingSelectedFileItem:(ItemPathModelView *)pathModelView;

/* Signals that an item in the tree has been replaced (by another one, of the same size). The item
 * itself is not part of the notification, but can be recognized because its parent directory has
 * been cleared.
 */
- (void) postFileItemDeleted;
- (void) fileItemDeletedHandled:(NSNotification *)notification;

/* Recursively updates the freed space count after the given item has been deleted.
 */
- (void) updateFreedSpaceForDeletedItem:(Item *)item;

@end


@implementation TreeContext

- (instancetype) initWithVolumePath:(NSString *)volumePath
                    fileSizeMeasure:(NSString *)fileSizeMeasure
                         volumeSize:(unsigned long long)volumeSize
                          freeSpace:(unsigned long long)freeSpace
                          filterSet:(FilterSet *)filterSet
                        monitorPath:(NSString *)pathToMonitor {
  return [self initWithVolumePath: volumePath
                  fileSizeMeasure: fileSizeMeasure
                       volumeSize: volumeSize
                        freeSpace: freeSpace
                        filterSet: filterSet
                         scanTime: [NSDate date]
                      monitorPath: pathToMonitor];
}

- (instancetype) initWithVolumePath:(NSString *)volumePath
                    fileSizeMeasure:(NSString *)fileSizeMeasure
                         volumeSize:(unsigned long long)volumeSize
                          freeSpace:(unsigned long long)freeSpace
                          filterSet:(FilterSet *)filterSet
                           scanTime:(NSDate *)scanTime {
  return [self initWithVolumePath: volumePath
                  fileSizeMeasure: fileSizeMeasure
                       volumeSize: volumeSize
                        freeSpace: freeSpace
                        filterSet: filterSet
                         scanTime: scanTime
                      monitorPath: nil];
}

- (instancetype) initWithVolumePath:(NSString *)volumePath
                    fileSizeMeasure:(NSString *)fileSizeMeasure
                         volumeSize:(unsigned long long)volumeSize
                          freeSpace:(unsigned long long)freeSpace
                          filterSet:(FilterSet *)filterSet
                           scanTime:(NSDate *)scanTime
                        monitorPath:(NSString *)pathToMonitor {
  if (self = [super init]) {
    _volumeTree = [[DirectoryItem alloc] initWithLabel: volumePath
                                                parent: nil
                                                 flags: 0
                                          creationTime: 0
                                      modificationTime: 0
                                            accessTime: 0];
    _scanTree = nil;
    
    usedSpaceItem = [[DirectoryItem alloc] initWithLabel: UsedSpace
                                                  parent: _volumeTree
                                                   flags: FileItemIsNotPhysical
                                            creationTime: 0
                                        modificationTime: 0
                                              accessTime: 0];
    
    _fileSizeMeasure = [fileSizeMeasure retain];
    _volumeSize = volumeSize;
    _freeSpace = freeSpace;
    _freedSpace = 0;
    _freedFiles = 0;
    
    _scanTime = [scanTime retain];

    if (pathToMonitor != nil) {
      treeMonitor = [[TreeMonitor alloc] initWithTreeContext: self forPath: pathToMonitor];
    } else {
      treeMonitor = nil;
    }

    // Ensure filter set is always set
    _filterSet = [(filterSet ?: [FilterSet filterSet]) retain];

    // Listen to self
    [NSNotificationCenter.defaultCenter addObserver: self
                                           selector: @selector(fileItemDeletedHandled:)
                                               name: FileItemDeletedHandledEvent
                                             object: self];
        
    mutex = [[NSLock alloc] init];
    lock = [[NSConditionLock alloc] initWithCondition: ConditionIdle];
    numReaders = 0;
    numWaitingReaders = 0;
    numWaitingWriters = 0;
  }
  
  return self;
}


- (void) dealloc {
  [NSNotificationCenter.defaultCenter removeObserver: self];

  [_volumeTree release];
  [usedSpaceItem release];
  [_scanTree release];
  
  [_fileSizeMeasure release];
  [_scanTime release];
  [_filterSet release];
  [treeMonitor release];
  
  [replacedItem release];
  [replacingItem release];
  
  [mutex release];
  [lock release];

  [super dealloc];
}

// Custom "setter"
- (void) setScanTree:(DirectoryItem *)scanTree {
  NSAssert(self.scanTree == nil, @"scanTree should be nil.");
  NSAssert(scanTree.parentDirectory == self.scanTreeParent, @"Invalid parent.");

  _scanTree = [scanTree retain];

  item_size_t  miscUsedSize = self.volumeSize;
  item_size_t  actualFreeSpace = self.freeSpace;
  BOOL  miscUsedSizeAnomaly = FALSE;
  if (scanTree.itemSize <= self.volumeSize) {
    miscUsedSize -= scanTree.itemSize;

    if (self.freeSpace <= miscUsedSize) {
      miscUsedSize -= self.freeSpace;
    }
    else {
      NSLog(@"Scanned tree size plus free space is larger than volume size.");
      miscUsedSizeAnomaly = TRUE;

      // Adapt actual free space, so that size of volumeTree still adds up to volume size.
      actualFreeSpace = miscUsedSize;
      miscUsedSize = 0;
    }
  } 
  else {
    NSLog(@"Scanned tree size is larger than volume size.");
    miscUsedSizeAnomaly = TRUE;

    // Set actual free space and misc used size both to zero to minimize difference between claimed
    // volume size and size of scanned items, which appears to be larger.
    actualFreeSpace = 0;
    miscUsedSize = 0;
  }

  if (miscUsedSizeAnomaly) {
    NSLog(@"Volume size=%qu (%@), Free space=%qu (%@), Scanned size=%qu (%@)",
          self.volumeSize, [FileItem stringForFileItemSize: self.volumeSize],
          self.freeSpace, [FileItem stringForFileItemSize: self.freeSpace],
          scanTree.itemSize, [FileItem stringForFileItemSize: scanTree.itemSize]);
  }

  FileItem  *freeSpaceItem = [[[FileItem alloc] initWithLabel: FreeSpace
                                                       parent: self.volumeTree
                                                         size: actualFreeSpace
                                                        flags: FileItemIsNotPhysical
                                                 creationTime: 0
                                             modificationTime: 0
                                                   accessTime: 0
                               ] autorelease];

  miscUsedSpaceItem = [[[FileItem alloc] initWithLabel: MiscUsedSpace
                                                parent: usedSpaceItem
                                                  size: miscUsedSize
                                                 flags: FileItemIsNotPhysical
                                          creationTime: 0
                                      modificationTime: 0
                                            accessTime: 0
                        ] autorelease];

  [usedSpaceItem setFileItems: miscUsedSpaceItem directoryItems: scanTree];
    
  [self.volumeTree setFileItems: freeSpaceItem directoryItems: usedSpaceItem];

  if (self.monitorsSource) {
    [treeMonitor startMonitoring];
  }
}


- (DirectoryItem *)scanTreeParent {
  return usedSpaceItem;
}

- (unsigned long long) miscUsedSpace {
  return miscUsedSpaceItem.itemSize;
}

- (BOOL) monitorsSource {
  return treeMonitor != nil;
}

- (int) numTreeChanges {
  return treeMonitor.numChanges;
}

- (NSString *)stringForScanTime {
  static NSDateFormatter *format = nil;
  if (format == nil) {
    format = [[NSDateFormatter alloc] init];
    format.timeStyle = NSDateFormatterShortStyle;
    format.dateStyle = NSDateFormatterShortStyle;
  }
  return [format stringFromDate: self.scanTime];
}

- (BOOL)usesTallyFileSize {
  return [self.fileSizeMeasure isEqualToString: TallyFileSizeName];
}

- (NSString *)stringForFileItemSize:(item_size_t)size {
  if (self.usesTallyFileSize) {
    if (size == 1) {
      return @"";
    }

    NSString  *format = NSLocalizedString(@"%qu files", @"Tally folder size (in number of files)");
    return [NSString stringWithFormat: format, size];
  } else {
    return [FileItem stringForFileItemSize: size];
  }
}

- (void) deleteSelectedFileItem:(ItemPathModelView *)pathModelView {
  NSAssert(replacedItem == nil, @"Replaced item not nil.");
  NSAssert(replacingItem == nil, @"Replacing item not nil.");
  
  replacedItem = [pathModelView.selectedFileItemInTree retain];
  replacingItem = [[FileItem alloc] initWithLabel: FreedSpace
                                           parent: replacedItem.parentDirectory
                                             size: replacedItem.itemSize
                                            flags: FileItemIsNotPhysical
                                     creationTime: 0
                                 modificationTime: 0
                                       accessTime: 0];

  Item  *containingItem = [self itemContainingSelectedFileItem: pathModelView];

  [self obtainWriteLock];
  if (containingItem.isVirtual) {
    CompoundItem  *compoundItem = (CompoundItem *)containingItem;
    
    if (compoundItem.first == replacedItem) {
      [compoundItem replaceFirst: replacingItem];
    }
    else if (compoundItem.second == replacedItem) {
      [compoundItem replaceSecond: replacingItem];
    }
    else {
      NSAssert(NO, @"Selected item not found.");
    }
  } 
  else {
    // Unusual case where the item is directly stored by its parent directory item because it is
    // the only child of this type (i.e. either a solitary file or sub-directory)
    DirectoryItem  *dirItem = (DirectoryItem *)containingItem;
  
    NSAssert(dirItem.isDirectory, @"Expected a DirectoryItem.");

    if (dirItem.fileItems == replacedItem) {
      [dirItem replaceFileItems: replacingItem];
    }
    else if (dirItem.directoryItems == replacedItem) {
      [dirItem replaceDirectoryItems: replacingItem];
    }
    else {
      NSAssert(NO, @"Selected item not found.");
    }
  } 
  [self releaseWriteLock];
  
  [self updateFreedSpaceForDeletedItem: replacedItem];

  [self postFileItemDeleted];
}

- (FileItem *)replacedFileItem {
  NSAssert(replacedItem != nil, @"replacedFileItem is nil.");
  return replacedItem;
}

- (FileItem *)replacingFileItem {
  NSAssert(replacingItem != nil, @"replacingFileItem is nil.");
  return replacingItem;
}


- (void) obtainReadLock {
  BOOL  wait = NO;

  [mutex lock];
  if (numReaders > 0) {
    // Already in READING state
    numReaders++;
  }
  else if ([lock tryLockWhenCondition: ConditionIdle]) {
    // Was in IDLE state, start reading
    numReaders++;
    [lock unlockWithCondition: ConditionReading];
  }
  else {
    // Currently in WRITE state, so will have to wait.
    numWaitingReaders++;
    wait = YES;
  }
  [mutex unlock];
  
  if (wait) {
    [lock lockWhenCondition: ConditionReading];
    // We are now allowed to read.
   
    [mutex lock];
    numWaitingReaders--;
    numReaders++;
    [mutex unlock];
     
    // Give up lock, allowing other readers to wake up as well.
    [lock unlockWithCondition: ConditionReading];
  }
}

- (void) releaseReadLock {
  [mutex lock];
  numReaders--;
  
  if (numReaders == 0) {
    [lock lockWhenCondition: ConditionReading]; // Immediately succeeds.
    
    if (numWaitingReaders > 0) {
      // Although there is no need for waiting readers in the READING state, this can happen if
      // waiting readers are not woken up quickly enough.
      [lock unlockWithCondition: ConditionReading];
    }
    else if (numWaitingWriters > 0) {
      [lock unlockWithCondition: ConditionWriting];
    }
    else {
      [lock unlockWithCondition: ConditionIdle];
    }
  }
  
  [mutex unlock];
}

- (void) obtainWriteLock {
  BOOL  wait = NO;

  [mutex lock];
  if ([lock tryLockWhenCondition: ConditionIdle]) {
    // Was in IDLE state, start writing
    
    // Note: Not releasing lock, to ensure that no other thread starts reading or writing.
    
    // Note: Although the condition of the lock is still IDLE, that does not matter as long as the
    // lock is being held. The condition only matters when the is (being) unlocked. The TreeContext
    // is now already considered to be in WRITING state.
  }
  else {
    // Currently in READING or WRITING state 
    numWaitingWriters++;
    wait = YES;
  }
  [mutex unlock];
  
  if (wait) {
    [lock lockWhenCondition: ConditionWriting];
    // We are now in the WRITING state.
   
    [mutex lock];
    numWaitingWriters--;
    [mutex unlock];
    
    // Note: Not releasing lock, to ensure that no other thread starts reading or writing.
  }
}

- (void) releaseWriteLock {
  [mutex lock]; 

  if (numWaitingReaders > 0) {
    [lock unlockWithCondition: ConditionReading];
  }
  else if (numWaitingWriters > 0) {
    [lock unlockWithCondition: ConditionWriting];
  }
  else {
    [lock unlockWithCondition: ConditionIdle];
  }
  
  [mutex unlock];
}

@end // TreeContext


@implementation TreeContext (PrivateMethods)

- (Item *)itemContainingSelectedFileItem:(ItemPathModelView *)pathModelView {
  FileItem  *selectedItem = pathModelView.selectedFileItemInTree;
  
  // Get the items in the path (from the underlying path model). 
  NSArray  *itemsInPath = pathModelView.pathModel.itemPath;
  NSUInteger  i = itemsInPath.count - 1;
  while (itemsInPath[i] != selectedItem) {
    NSAssert(i > 0, @"Item not found.");
    i--;
  }

  // Found the item. Return the one just above it in the path. 
  return itemsInPath[i - 1];
}


- (void) postFileItemDeleted {
  NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;

  [nc postNotificationName: FileItemDeletedEvent object: self];
  [nc postNotificationName: FileItemDeletedHandledEvent object: self];
}

- (void) fileItemDeletedHandled:(NSNotification *)notification {
  [replacedItem release];
  replacedItem = nil;
  
  [replacingItem release];
  replacingItem = nil; 
}

- (void) updateFreedSpaceForDeletedItem:(Item *)item {
  if (item == nil) {
    return; // Can happen for children of a directory item
  }

  if (item.isVirtual) {
    [self updateFreedSpaceForDeletedItem: ((CompoundItem *)item).first];
    [self updateFreedSpaceForDeletedItem: ((CompoundItem *)item).second];
  }
  else {
    FileItem  *fileItem = (FileItem *)item;
    
    // Note: Deletion of hard-linked items is included in the freedSpace accounting, even though
    // the free space on the harddrive won't be increased until all instances have been deleted.
    // The reason is that not doing can result in strange anomalies. For example, deleting a
    // directory that contains one or more hard-linked files increases the freedSpace count by less
    // than the size of the "freed space" block that replaces all files that have been deleted.

    if (fileItem.isDirectory) {
      [self updateFreedSpaceForDeletedItem: ((DirectoryItem *)item).fileItems];
      [self updateFreedSpaceForDeletedItem: ((DirectoryItem *)item).directoryItems];
    }
    else {
      if (fileItem.isPhysical) {
        // The item is physical so we freed up some space. (Non-physical items, including already
        // freed space, should not be counted)
        _freedSpace += item.itemSize;
        _freedFiles++;
      }
    }
  }
}

@end // TreeContext (PrivateMethods)
