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

#import "FileItem.h"


/* Bitmasks used for the "dirty" flags field of the DirectoryItem
 */
typedef NS_OPTIONS(UInt8, DirectoryRescanOptions) {
  DirectoryIsUpToDate = 0,
  DirectoryNeedsShallowRescan = 0x01,
  DirectoryNeedsFullRescan = 0x02,
};

@class PlainFileItem;
@class TreeBalancer;

@interface DirectoryItem : FileItem {
}

// Overrides designated initialiser
- (instancetype) initWithLabel:(NSString *)label
                        parent:(DirectoryItem *)parent
                          size:(item_size_t)size
                         flags:(FileItemOptions)flags
                  creationTime:(CFAbsoluteTime)creationTime
              modificationTime:(CFAbsoluteTime)modificationTime
                    accessTime:(CFAbsoluteTime)accessTime NS_UNAVAILABLE;

/* A directory item is initialized without a size. It will be set when its contents are set using
 * setFileItems:directoryItems.
 */
- (instancetype) initWithLabel:(NSString *)label
                        parent:(DirectoryItem *)parent
                         flags:(FileItemOptions)flags
                  creationTime:(CFAbsoluteTime)creationTime
              modificationTime:(CFAbsoluteTime)modificationTime
                    accessTime:(CFAbsoluteTime)accessTime NS_DESIGNATED_INITIALIZER;

/* This method can be used to set the (balanced) trees for the file and sub-dirirectory children at
 * once.
 */
- (void) setFileItems:(Item *)fileItems
       directoryItems:(Item *)dirItems;

/* The addFile: and addSubDir: methods can be used to add file and sub-directory children one at a
 * time. Once done, the size should be locked using setSize, and the trees balanced using
 * balanceTree:
 */
- (void) addFile:(FileItem *)fileItem;
- (void) addSubdir:(FileItem *)dirItem;
- (void) setSize;
- (void) balanceTree:(TreeBalancer *)treeBalancer;

/* Replaces the directory contents. The item must have the same size as the original item (otherwise
 * the resulting tree would be incorrect).
 *
 * Note: It is the responsibility of the sender to ensure that this method is only called when the
 * tree can be modified (e.g. it should not be traversed in another thread). Furthermore, the sender
 * is responsible for notifying objects affected by the change.
 */
- (void) replaceFileItems:(Item *)newItem;
- (void) replaceDirectoryItems:(Item *)newItem;

/* The immediate children that are plain files. Depending on the number of file children it
 * returns:
 * 0 => nil
 * 1 => PlainFileItem
 * 2+ => a CompoundItem tree with PlainFileItem leaves
 */
@property (nonatomic, readonly, strong) Item *fileItems;

/* The immediate children that are directories. Depending on the number it returns:
 * 0 => nil
 * 1 => DirectoryItem
 * 2+ => a CompoundItem tree with DirectoryItem leaves
 */
@property (nonatomic, readonly, strong) Item *directoryItems;

/* Returns all immediate children, both plain file items as well as directories. This constructs
 * a temporary CompoundItem object when the directory contains both types of children.
 */
@property (nonatomic, readonly, strong) Item *childItems;

/* Return the directory represented as plain file.
 */
@property (nonatomic, readonly, strong) PlainFileItem *directoryAsPlainFile;

/* Returns the directory files represented as a plain file.
 *
 * This excludes files in sub-directories.
 */
@property (nonatomic, readonly, strong) PlainFileItem *groupedFiles;

/* Returns the item that represents the receiver when package contents should not be shown (i.e.
 * when the directory should be represented by a file).
 */
@property (nonatomic, readonly, strong) FileItem *itemWhenHidingPackageContents;

/* Indicates if the state of the directory on disk has been changed since this object has been
 * created.
 *
 * This property can be modified using setRescanFlag:.
 */
@property (nonatomic, readonly) DirectoryRescanOptions rescanFlags;

/* Sets the given rescan flag(s). Return YES if this resulted in a change.
 *
 * A mutex is used to ensure the update is thread-safe.
 */
- (BOOL) setRescanFlag:(DirectoryRescanOptions)flag;

/* Returns the maximum depth (the directory nesting level) of this part of the file tree. The
 * maximum level that is returned will not exceed upperBound. In other words, this parameter can be
 * used to restrict the search.
 */
- (int) maxDepth: (int)upperBound packagesAsFiles: (BOOL)packagesAsFiles;

@end
