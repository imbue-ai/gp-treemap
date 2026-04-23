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

#import "Item.h"

extern NSString  *FreeSpace;
extern NSString  *UsedSpace;
extern NSString  *MiscUsedSpace;
extern NSString  *FreedSpace;

extern NSString  *FileItemDeletedEvent;

@class FileItem;
@class FilterSet;
@class DirectoryItem;
@class ItemPathModelView;
@class TreeMonitor;


@interface TreeContext : NSObject {
  DirectoryItem  *usedSpaceItem;
  FileItem  *miscUsedSpaceItem;
  
  FileItem  *replacedItem;
  FileItem  *replacingItem;

  TreeMonitor  *treeMonitor;

  // Variables used for synchronizing read/write access to the tree.
  NSLock  *mutex;
  NSConditionLock  *lock;
  
  // The number of active reading threads.
  int  numReaders;
  
  // The number of threads currently waiting using "lock"
  int  numWaitingReaders;
  int  numWaitingWriters;
}

// Overrides designated initialiser
- (instancetype) init NS_UNAVAILABLE;

/* Creates a new tree context, with the scan time set to "now" and source monitoring enabled for
 * the given path.
 */
- (instancetype) initWithVolumePath:(NSString *)volumePath
                    fileSizeMeasure:(NSString *)fileSizeMeasure
                         volumeSize:(unsigned long long)volumeSize
                          freeSpace:(unsigned long long)freeSpace
                          filterSet:(FilterSet *)filterSet
                        monitorPath:(NSString *)pathToMonitor;

/* Creates a new tree context without the source being monitored. It should be used for trees that
 * are not created by a fresh scan but loaded from file instead.
 */
- (instancetype) initWithVolumePath:(NSString *)volumePath
                    fileSizeMeasure:(NSString *)fileSizeMeasure
                         volumeSize:(unsigned long long)volumeSize
                          freeSpace:(unsigned long long)freeSpace
                          filterSet:(FilterSet *)filterSet
                           scanTime:(NSDate *)scanTime;

/* Creates a new tree context. 
 *
 * Note: The returned object is not yet fully ready. A volume-tree skeleton is created, but still
 * needs to be finalised. The scanTree still needs to be set using -setScanTree.
 */
- (instancetype) initWithVolumePath:(NSString *)volumePath
                    fileSizeMeasure:(NSString *)fileSizeMeasure
                         volumeSize:(unsigned long long)volumeSize
                          freeSpace:(unsigned long long)freeSpace
                          filterSet:(FilterSet *)filterSet
                           scanTime:(NSDate *)scanTime
                        monitorPath:(NSString *)pathToMonitor NS_DESIGNATED_INITIALIZER;


/* Sets the scan tree. This finalises the volume tree. The parent of the scan tree should be that
 * returned by -scanTreeParent.
 */

/* The parent (to be) for the scan tree.
 */
@property (nonatomic, readonly, strong) DirectoryItem *scanTreeParent;


@property (nonatomic, readonly, strong) DirectoryItem *volumeTree;
@property (nonatomic, strong) DirectoryItem *scanTree;

/* Flag that indicates if the source is being monitored for changes after the tree has been
 * created. If so -DirectoryItem.rescanFlags tracks if a directory is outdated.
 */
@property (nonatomic, readonly) BOOL monitorsSource;

/* Returns the number of detected tree changes. It can only become non-zero when the tree is
 * being monitored.
 */
@property (nonatomic, readonly) int numTreeChanges;

/* The size of the volume (in bytes)
 */
@property (nonatomic, readonly) unsigned long long volumeSize;

/* The free space of the volume at the time of the scan (as claimed by the system). The free space
 * in the volume tree may be less. The latter is reduced if not doing so would cause the size of
 * scanned files plus the free space to be more than the volume size.
 */
@property (nonatomic, readonly) unsigned long long freeSpace;

/* The miscellaneous used space
 */
@property (nonatomic, readonly) unsigned long long miscUsedSpace;

/* The space that has been freed using -deleteSelectedFileItem since the scan.
 */
@property (nonatomic, readonly) unsigned long long freedSpace;

/* The number of freed files
 */
@property (nonatomic, readonly) unsigned long long freedFiles;

@property (nonatomic, readonly, copy) NSString *fileSizeMeasure;

@property (nonatomic, readonly, copy) NSDate *scanTime;

/* A string representation for the scan time.
 */
@property (nonatomic, readonly, copy) NSString *stringForScanTime;

@property (nonatomic, readonly, strong) FilterSet *filterSet;

- (BOOL)usesTallyFileSize;

/* Returns a user-friendly representation for the given file size.
 *
 * It should only be used for item in its own tree, as the string representation depends on the
 * measure that was used.
 */
- (NSString *)stringForFileItemSize:(item_size_t)size;

- (void) deleteSelectedFileItem:(ItemPathModelView *)path;

/* Returns the item that is being replaced.
 *
 * It should only be called in response to a TreeItemReplacedEvent. It will return "nil" otherwise.
 */
@property (nonatomic, readonly, strong) FileItem *replacedFileItem;

/* Returns the item that replaces the item that is being replaced.
 *
 * It should only be called in response to a TreeItemReplacedEvent. It will return "nil" otherwise.
 */
@property (nonatomic, readonly, strong) FileItem *replacingFileItem;


/* Obtains a read lock on the tree. This is required before reading, e.g. traversing, (parts of) the
 * tree. There can be multiple readers active simultaneously.
 */
- (void) obtainReadLock;

- (void) releaseReadLock;

/* Obtains a write lock. This is required before modifying the tree. A write lock is only given out
 * when there are no readers. A thread should only try to acquire a write lock, if it does not
 * already own a read lock, otherwise a deadlock will result.
 *
 * Note: Although not required by the implementation of the lock, the current usage is as follows.
 * Only the main thread will make modifications (after having acquired a write lock). The background
 * threads that read the tree (e.g. to draw it) always obtain read locks first. However, the main
 * thread never acquires a read lock; there is no need because writing is not done from other
 * threads.
 */
- (void) obtainWriteLock;

- (void) releaseWriteLock;

@end
