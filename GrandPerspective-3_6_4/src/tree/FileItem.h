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

/* Bitmasks used for the flags field of the FileItem
 */
// Note: Using "NOT_PHYSICAL" as a mask as opposed to "PHYSICAL" so that a set bit signals an
// exceptional setting.
typedef NS_OPTIONS(UInt8, FileItemOptions) {
  FileItemIsPlain = 0,
  FileItemIsNotPhysical = 0x01,
  FileItemIsHardlinked = 0x02,
  FileItemIsPackage = 0x04
};


@class DirectoryItem;

@interface FileItem : Item {
  // Cannot synthesize weak properties apparently
  __weak DirectoryItem *_parentDirectory;
}

/* The supported values for the fileSizeUnitSystem preference. These affect how the file size
 * strings are constructed.
 */
@property (class, nonatomic, readonly) NSArray *fileSizeUnitSystemNames;

/* Returns the number of bytes per kilobyte. It can be either 1024 or 1000 based on the 
 * fileSizeMeasurePreference.
 */
@property (class, nonatomic, readonly) int bytesPerKilobyte;

// Overrides super's designated initialiser.
- (instancetype) initWithItemSize:(item_size_t) sizeVal NS_UNAVAILABLE;

- (instancetype) initWithLabel:(NSString *)label
                        parent:(DirectoryItem *)parent
                          size:(item_size_t)size
                         flags:(FileItemOptions)flags
                  creationTime:(CFAbsoluteTime)creationTime
              modificationTime:(CFAbsoluteTime)modificationTime
                    accessTime:(CFAbsoluteTime)accessTime NS_DESIGNATED_INITIALIZER;


/* Creates a duplicate item, for use in a new tree (so with a new parent).
 *
 * Note: If the item is a directory, its contents still need to be set, as these can be different
 * from the original item, e.g. by applying a filter.
 */
- (FileItem *)duplicateFileItem:(DirectoryItem *)newParent;

/* The label of the item. For physical file items this is the system representation of its path
 * component. For other non-physical items, it is a non-localized string identifier.
 */
@property (nonatomic, readonly, copy) NSString *label;

@property (nonatomic, readonly, weak) DirectoryItem *parentDirectory;

- (BOOL) isAncestorOfFileItem:(FileItem *)fileItem;
  
/* Returns YES iff the file item is a directory.
 */
@property (nonatomic, getter=isDirectory, readonly) BOOL directory;


/* Time when the file item was created.
 */
@property (nonatomic, readonly) CFAbsoluteTime creationTime;

/* Time when the file item was last modified.
 */
@property (nonatomic, readonly) CFAbsoluteTime modificationTime;

/* Time when the file item was last accessed.
 */
@property (nonatomic, readonly) CFAbsoluteTime accessTime;


/* Bit-mask flags. Lower-level representation for the file's physical, hard-linked, and package
 * status.
 */
@property (nonatomic, readonly) FileItemOptions fileItemFlags;

/* Returns YES iff the file item is physical, i.e. it is an actual file on the file system. A file
 * item that is not physical may for example represent the free space on a volume.
 */
@property (nonatomic, getter=isPhysical, readonly) BOOL physical;

/* Returns YES iff the file item is hardlinked.
 */
@property (nonatomic, getter=isHardLinked, readonly) BOOL hardLinked;

/* Return YES iff the file item is a package.
 *
 * Note: Although packages are always directories in the underlying file system, they may be
 * represented by file items that are plain files (namely when package contents are hidden). This is
 * the reason that this method is introduced by the FileItem class.
 */
@property (nonatomic, getter=isPackage, readonly) BOOL package;


/* Returns the path component that the item contributes to the path. The path component is nil if
 * the item is not physical.
 */
@property (nonatomic, readonly, copy) NSString *pathComponent;

/* Returns the path to the file item. It is the path as shown to the user. The system representation
 * of the path can be different. This is for example the case when a path component contains slash
 * characters.
 *
 * See also: -systemPath
 */
@property (nonatomic, readonly, copy) NSString *path;

/* Returns the path to the file item, in the file system representation.
 * 
 * See also: -path
 */
@property (nonatomic, readonly, copy) NSString *systemPath;


/* Returns a short string, approximating the given size. E.g. "1.23 MB"
 *
 * Note: This method assumes that the file size measure is "bytes". It should not be used, for
 * example, when the tally file size measure is used.
 */
+ (NSString *)stringForFileItemSize:(item_size_t)size;

/* Returns a string for the provided time.
 */
+ (NSString *)stringForTime:(CFAbsoluteTime)absTime;

/* Returns path component as it is displayed to user, with colons replaced by slashes.
 */
+ (NSString *)friendlyPathComponentFor:(NSString *)pathComponent;

/* Returns path component as it is used by system, with slashes replaced by colons.
 */
+ (NSString *)systemPathComponentFor:(NSString *)pathComponent;

@end // @interface FileItem


@interface FileItem (ProtectedMethods) 

/* Returns the path component that the item contributes to the path, in the file system
 * representation.
 *
 * See also -pathComponent.
 */
@property (nonatomic, readonly, copy) NSString *systemPathComponent;

@end // @interface FileItem (ProtectedMethods)
